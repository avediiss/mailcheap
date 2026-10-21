import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
});

const sent = () => globalThis.__sentEmails;
const recipients = () => sent().map(({ to }) => to).toSorted();

async function queueIssue(tenant, contact = tenant.contact) {
	await db.models.Campaign.updateOne({ _id: tenant.campaign._id }, { $set: { status: "sending" } });
	return db.models.Message.create({
		kind: "campaign",
		workspaceId: tenant.workspace._id,
		campaignId: tenant.campaign._id,
		newsletterId: tenant.newsletter._id,
		contactId: contact._id,
		email: contact.email,
		status: "queued",
	});
}

function sesEvent(eventType, message, detail) {
	const key = { Bounce: "bounce", Complaint: "complaint" }[eventType];
	return {
		eventType,
		mail: {
			timestamp: "2026-10-04T10:00:00.000Z",
			messageId: "ses-id-1",
			destination: [message.email],
			tags: { message_id: [String(message._id)], kind: ["campaign"] },
		},
		[key]: detail,
	};
}

test("a normal send goes out, stamped with the workspace, from the workspace's own domain", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	const message = await queueIssue(a);
	const result = await sendMessageBatch([String(message._id)]);
	assert.equal(result.sent, 1);
	assert.deepEqual(recipients(), [a.contact.email]);
	assert.ok(sent()[0].from.includes("hello@acme.test"));
	const stored = await db.models.Message.findById(message._id);
	assert.equal(stored.status, "sent");
	assert.equal(String(stored.workspaceId), String(a.workspace._id));
});

test("a suspended workspace sends nothing: the campaign pauses and its owners and the platform owner are told", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "suspended" } });
	const message = await queueIssue(a);

	const result = await sendMessageBatch([String(message._id)]);
	assert.equal(result.sent, 0);
	assert.equal((await db.models.Message.findById(message._id)).status, "queued", "left untouched, not marked sent");
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "paused");
	// The only email is the alert: to Acme's owner and to the platform owner, never to the subscriber.
	assert.deepEqual(recipients(), ["owner@acme.test", process.env.ADMIN_EMAIL].toSorted());
	assert.ok(!recipients().includes(a.contact.email));
});

test("a from address outside the workspace's domains is never sent, even if the newsletter says so", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { fromEmail: "hello@birch.test" } });
	const message = await queueIssue(a);

	assert.equal((await sendMessageBatch([String(message._id)])).sent, 0);
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "paused");
	assert.ok(!recipients().includes(a.contact.email));
});

test("welcome and series emails that fail the gate are marked failed, with the reason", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { fromEmail: "hello@elsewhere.test" } });
	const message = await db.models.Message.create({
		kind: "welcome",
		workspaceId: a.workspace._id,
		newsletterId: a.newsletter._id,
		contactId: a.contact._id,
		email: a.contact.email,
	});
	const result = await sendMessageBatch([String(message._id)]);
	assert.equal(result.sent, 0);
	const stored = await db.models.Message.findById(message._id);
	assert.equal(stored.status, "failed");
	assert.match(stored.error, /not on one of this workspace's domains/);
});

test("a complaint suppresses an address only in the workspace it happened in; a bounce suppresses it everywhere", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	const { handleSesEvent } = await import("@/lib/ses-events");
	const shared = "shared@example.com";
	const inA = await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: shared, status: "active" });
	const inB = await db.models.Contact.create({ workspaceId: b.workspace._id, newsletterId: b.newsletter._id, email: shared, status: "active" });
	const messageA = await queueIssue(a, inA);

	await handleSesEvent(sesEvent("Complaint", messageA, { complainedRecipients: [{ emailAddress: shared }], timestamp: "2026-10-04T10:00:01.000Z" }));
	const rows = await db.models.Suppression.find({ email: shared }).lean();
	assert.equal(rows.length, 1);
	assert.equal(String(rows[0].workspaceId), String(a.workspace._id));
	assert.equal(rows[0].reason, "complaint");
	assert.equal((await db.models.Contact.findById(inA._id)).status, "complained");
	assert.equal((await db.models.Contact.findById(inB._id)).status, "active", "B's contact is untouched");

	// B can still email the address; A cannot.
	const messageB = await queueIssue(b, inB);
	assert.equal((await sendMessageBatch([String(messageB._id)])).sent, 1);

	// A bounce is global: both workspaces lose the address.
	await handleSesEvent(
		sesEvent("Bounce", messageB, {
			bounceType: "Permanent",
			bounceSubType: "General",
			bouncedRecipients: [{ emailAddress: shared }],
			timestamp: "2026-10-04T10:00:02.000Z",
		})
	);
	const global = await db.models.Suppression.findOne({ email: shared, reason: "bounce" });
	assert.equal(global.workspaceId ?? null, null);
	assert.equal((await db.models.Contact.findById(inB._id)).status, "bounced");
});

test("signing up in one workspace respects that workspace's complaints and everyone's bounces, not another workspace's", async () => {
	const { upsertContact } = await import("@/lib/contacts");
	const { importContactRows } = await import("@/lib/contact-import");
	await importContactRows({
		workspaceId: a.workspace._id,
		newsletterId: a.newsletter._id,
		rows: [
			{ email: "complainer@example.com", status: "complained" },
			{ email: "bouncer@example.com", status: "bounced" },
		],
	});
	const rows = await db.models.Suppression.find().lean();
	assert.equal(String(rows.find(({ email }) => email === "complainer@example.com").workspaceId), String(a.workspace._id));
	assert.equal(rows.find(({ email }) => email === "bouncer@example.com").workspaceId ?? null, null);

	const newsletterA = await db.models.Newsletter.findById(a.newsletter._id).lean();
	const newsletterB = await db.models.Newsletter.findById(b.newsletter._id).lean();
	assert.equal((await upsertContact({ newsletter: newsletterA, email: "complainer@example.com", source: "api" })).contact.status, "complained");
	assert.equal((await upsertContact({ newsletter: newsletterB, email: "complainer@example.com", source: "api" })).contact.status, "active", "B didn't suffer A's complaint");
	assert.equal((await upsertContact({ newsletter: newsletterB, email: "bouncer@example.com", source: "api" })).contact.status, "bounced", "a bounce follows the address everywhere");
	assert.equal(String((await db.models.Contact.findOne({ newsletterId: b.newsletter._id, email: "complainer@example.com" })).workspaceId), String(b.workspace._id));
});

test("an address complained about in another workspace doesn't block a send here", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await db.models.Suppression.create({ email: a.contact.email, reason: "complaint", workspaceId: b.workspace._id });
	const message = await queueIssue(a);
	assert.equal((await sendMessageBatch([String(message._id)])).sent, 1);

	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	await db.models.Suppression.create({ email: a.contact.email, reason: "complaint", workspaceId: a.workspace._id });
	const blocked = await queueIssue(a);
	assert.equal((await sendMessageBatch([String(blocked._id)])).suppressed, 1);
});

test("test emails go to the person who asked, and respect the gate", async () => {
	const actions = await import("@/app/(app)/campaigns/actions");
	await loginAs(a.owner);
	assert.deepEqual(await actions.sendTestCampaign(String(a.campaign._id)), { ok: true });
	assert.deepEqual(recipients(), ["owner@acme.test"], "not to the platform owner's ADMIN_EMAIL");
	const test = await db.models.Message.findOne({ kind: "test" });
	assert.equal(String(test.workspaceId), String(a.workspace._id));

	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "suspended" } });
	assert.deepEqual(await actions.sendTestCampaign(String(a.campaign._id)), { error: "This workspace is suspended" });

	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "active" } });
	await db.models.Domain.deleteMany({ workspaceId: a.workspace._id });
	assert.match((await actions.sendTestCampaign(String(a.campaign._id))).error, /not on one of this workspace's domains/);
});

test("new-subscriber notices go to the workspace's owners only, never to the platform owner", async () => {
	const { notifyNewSubscriber } = await import("@/lib/signup-notice");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { notifyOnSignup: true } });
	const newsletter = await db.models.Newsletter.findById(a.newsletter._id).lean();
	const contact = await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "fresh@example.com", status: "active", source: "website" });

	await notifyNewSubscriber({ newsletter, contact: contact.toObject() });
	assert.deepEqual(recipients(), ["owner@acme.test"]);
	assert.ok(sent()[0].text.includes("fresh@example.com"));
});

test("messages created by signup, welcome and series emails carry the workspace", async () => {
	const { queueWelcomeEmail, sendSequenceEmail } = await import("@/lib/sending");
	await db.models.Newsletter.updateOne(
		{ _id: a.newsletter._id },
		{ $set: { welcome: { enabled: true, subject: "Welcome", markdown: "Hello" }, sequence: { enabled: true, steps: [{ delayDays: 2, subject: "Day 2", markdown: "More" }] } } }
	);
	const newsletter = await db.models.Newsletter.findById(a.newsletter._id).lean();
	const contact = await db.models.Contact.findById(a.contact._id).lean();

	await queueWelcomeEmail({ newsletter, contact });
	await sendSequenceEmail({ newsletter, contact, step: 0 });
	const messages = await db.models.Message.find({ contactId: a.contact._id }).lean();
	assert.deepEqual(messages.map(({ kind }) => kind).toSorted(), ["sequence", "welcome"]);
	assert.ok(messages.every(({ workspaceId, status }) => String(workspaceId) === String(a.workspace._id) && status === "sent"));
	assert.equal(sent().length, 2);
});

test("audience counts and segment options only see the workspace's own contacts", async () => {
	const { countAudience, getSegmentOptions } = await import("@/lib/campaign-audience");
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { tags: ["vip"] } });
	await db.models.Contact.updateOne({ _id: b.contact._id }, { $set: { tags: ["vip", "secret-b-tag"] } });

	assert.equal(await countAudience({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id }), 1);
	assert.equal(await countAudience({ workspaceId: a.workspace._id, newsletterId: b.newsletter._id }), 0, "A can't count B's newsletter");
	const options = await getSegmentOptions(a.workspace._id, a.newsletter._id);
	assert.deepEqual(options.tags, [{ value: "vip", count: 1 }]);
	assert.ok(!JSON.stringify(options).includes("secret-b-tag"));
});
