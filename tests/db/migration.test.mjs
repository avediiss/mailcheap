import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { startDb } from "./helpers.mjs";

let db;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(() => db.reset());

// Data as the install has it today: nothing has a workspaceId (raw inserts skip the new required field).
async function seedLegacy() {
	const { Newsletter, Contact, Campaign, Message, ApiKey, Event, Suppression } = db.models;
	const newsletterId = (await Newsletter.collection.insertOne({ name: "Avedis Notes", slug: "avedis-notes", fromEmail: "news@abakelianavedis.com", createdAt: new Date(), updatedAt: new Date() })).insertedId;
	const contactId = (await Contact.collection.insertOne({ newsletterId, email: "reader@example.com", status: "active", createdAt: new Date(), updatedAt: new Date() })).insertedId;
	const campaignId = (await Campaign.collection.insertOne({ newsletterId, subject: "Hi", status: "sent", createdAt: new Date(), updatedAt: new Date() })).insertedId;
	const messageId = (await Message.collection.insertOne({ kind: "campaign", newsletterId, campaignId, contactId, email: "reader@example.com", status: "sent", createdAt: new Date(), updatedAt: new Date() })).insertedId;
	await ApiKey.collection.insertOne({ name: "Portfolio site", prefix: "mc_abc", hash: "h1", createdAt: new Date(), updatedAt: new Date() });
	await Event.collection.insertMany([
		{ type: "Bounce", messageId, campaignId, email: "reader@example.com", createdAt: new Date() },
		{ type: "Complaint", campaignId, email: "reader@example.com", createdAt: new Date() },
		{ type: "Bounce", email: "orphan@example.com", createdAt: new Date() },
	]);
	// The old rule: one suppression per address, enforced by a unique index on email alone.
	await Suppression.collection.createIndex({ email: 1 }, { unique: true, name: "email_1" });
	await Suppression.collection.insertMany([
		{ email: "bounced@example.com", reason: "bounce", createdAt: new Date(), updatedAt: new Date() },
		{ email: "complained@example.com", reason: "complaint", createdAt: new Date(), updatedAt: new Date() },
		{ email: "optout@example.com", reason: "manual", createdAt: new Date(), updatedAt: new Date() },
	]);
	return { newsletterId, contactId, campaignId, messageId };
}

const options = { adminEmail: "owner@platform.test", adminPassword: "platform owner password" };

test("a dry run reports what it would do and writes nothing", async () => {
	await seedLegacy();
	const summary = await (await import("@/lib/migrate-workspaces")).migrateWorkspaces({ ...options, dryRun: true });

	assert.equal(summary.dryRun, true);
	assert.deepEqual([summary.newsletters, summary.contacts, summary.campaigns, summary.messages, summary.apiKeys, summary.events, summary.suppressions], [1, 1, 1, 1, 1, 3, 2]);
	assert.deepEqual(summary.domains, ["abakelianavedis.com"]);
	assert.equal(await db.models.Workspace.countDocuments(), 0);
	assert.equal(await db.models.User.countDocuments(), 0);
	assert.equal(await db.models.Domain.countDocuments(), 0);
	assert.equal(await db.models.Newsletter.countDocuments({ workspaceId: { $exists: true } }), 0);
	assert.ok((await db.models.Suppression.collection.indexes()).some(({ name }) => name === "email_1"), "the old index is still there");
});

test("the migration gives everything a workspace, creates the owner, the domain and the new suppression rule", async () => {
	const ids = await seedLegacy();
	const { migrateWorkspaces } = await import("@/lib/migrate-workspaces");
	const summary = await migrateWorkspaces({ ...options, dryRun: false });

	const workspace = await db.models.Workspace.findOne({ slug: "avedis" });
	assert.ok(workspace);
	assert.deepEqual(summary.remaining, { newsletters: 0, contacts: 0, campaigns: 0, messages: 0, apiKeys: 0, events: 0 });
	for (const name of ["Newsletter", "Contact", "Campaign", "Message", "ApiKey", "Event"]) {
		assert.equal(await db.models[name].countDocuments({ workspaceId: { $ne: workspace._id } }), 0, `${name} all belong to the workspace`);
	}

	const owner = await db.models.User.findOne({ email: "owner@platform.test" });
	assert.equal(owner.isPlatformAdmin, true);
	assert.ok(await db.models.Membership.exists({ userId: owner._id, workspaceId: workspace._id, role: "owner" }));
	const { authenticate } = await import("@/lib/auth");
	assert.ok(await authenticate("owner@platform.test", "platform owner password"), "they can log in");

	assert.deepEqual((await db.models.Domain.find().lean()).map(({ domain }) => domain), ["abakelianavedis.com"]);
	const { isSenderAllowed } = await import("@/lib/workspace-rules");
	assert.equal(isSenderAllowed(["abakelianavedis.com"], "news@abakelianavedis.com"), true, "the newsletter can keep sending");

	// Complaints and opt-outs became the workspace's; the bounce stayed global.
	const byEmail = Object.fromEntries((await db.models.Suppression.find().lean()).map((row) => [row.email, row]));
	assert.equal(byEmail["bounced@example.com"].workspaceId ?? null, null);
	assert.equal(String(byEmail["complained@example.com"].workspaceId), String(workspace._id));
	assert.equal(String(byEmail["optout@example.com"].workspaceId), String(workspace._id));
	assert.ok(!(await db.models.Suppression.collection.indexes()).some(({ name }) => name === "email_1"), "the old index is gone");
	await db.models.Suppression.create({ email: "complained@example.com", reason: "complaint", workspaceId: (await db.models.Workspace.create({ name: "Other", slug: "other" }))._id });

	// Everything still works through the real code: the dashboard's own queries find the data.
	const { buildContactFilters } = await import("@/lib/contact-filter");
	assert.equal(await db.models.Contact.countDocuments(buildContactFilters({ workspaceId: workspace._id }).filter), 1);
	assert.equal(String((await db.models.Event.findOne({ type: "Complaint" })).workspaceId), String(workspace._id), "an event follows its campaign");
	assert.equal(String((await db.models.Event.findOne({ email: "orphan@example.com" })).workspaceId), String(workspace._id), "an event with no message falls back to the workspace");
	assert.equal(String((await db.models.Message.findById(ids.messageId)).workspaceId), String(workspace._id));
});

test("running it again changes nothing", async () => {
	await seedLegacy();
	const { migrateWorkspaces } = await import("@/lib/migrate-workspaces");
	await migrateWorkspaces({ ...options, dryRun: false });
	const counts = async () => Object.fromEntries(await Promise.all(Object.entries(db.models).map(async ([name, model]) => [name, await model.countDocuments()])));
	const before = await counts();
	const second = await migrateWorkspaces({ ...options, dryRun: false });
	assert.deepEqual(await counts(), before);
	assert.deepEqual([second.newsletters, second.contacts, second.campaigns, second.messages, second.apiKeys, second.events, second.suppressions], [0, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(second.domains, []);
});

test("a later run doesn't hand an unattributed complaint to the first workspace unless asked", async () => {
	await seedLegacy();
	const { migrateWorkspaces } = await import("@/lib/migrate-workspaces");
	await migrateWorkspaces({ ...options, dryRun: false });
	await db.models.Suppression.collection.insertOne({ email: "unknown-complaint@example.com", reason: "complaint", createdAt: new Date(), updatedAt: new Date() });

	await migrateWorkspaces({ ...options, dryRun: false });
	assert.equal((await db.models.Suppression.findOne({ email: "unknown-complaint@example.com" })).workspaceId ?? null, null, "left global");
	await migrateWorkspaces({ ...options, dryRun: false, assignSuppressions: true });
	assert.ok((await db.models.Suppression.findOne({ email: "unknown-complaint@example.com" })).workspaceId, "assigned when asked");
});

test("without an admin password the account is left for the first login, which still works", async () => {
	await seedLegacy();
	const { migrateWorkspaces } = await import("@/lib/migrate-workspaces");
	await migrateWorkspaces({ adminEmail: "owner@platform.test", dryRun: false });
	assert.equal(await db.models.User.countDocuments(), 0);
	const { authenticate } = await import("@/lib/auth");
	const user = await authenticate("owner@platform.test", process.env.ADMIN_PASSWORD);
	assert.equal(user.isPlatformAdmin, true);
	// The platform owner needs no membership to use every workspace.
	const { default: Workspace } = await import("@/models/Workspace");
	assert.equal(await Workspace.countDocuments(), 1);
});
