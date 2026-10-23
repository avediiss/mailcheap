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

const id = (doc) => String(doc._id);

// The page is JSX, which these tests can't load; what it shows comes from lib/contact-activity.js (unit tests)
// and from the same workspace-scoped queries it runs, checked here.
test("a contact's messages and campaigns are found only inside its own workspace", async () => {
	const { buildActivity } = await import("@/lib/contact-activity");
	await db.models.Message.create({ kind: "campaign", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, contactId: a.contact._id, email: a.contact.email, status: "sent", sentAt: new Date(), openedAt: new Date() });
	await db.models.Message.create({ kind: "test", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, email: "owner@acme.test", status: "sent", sentAt: new Date() });

	const mine = await db.models.Message.find({ contactId: a.contact._id, workspaceId: a.workspace._id, kind: { $ne: "test" } }).lean();
	assert.equal(mine.length, 1);
	const subjects = new Map((await db.models.Campaign.find({ _id: a.campaign._id, workspaceId: a.workspace._id }).lean()).map(({ _id, subject }) => [String(_id), subject]));
	const events = buildActivity({ contact: await db.models.Contact.findById(a.contact._id).lean(), messages: mine, campaignSubjects: subjects });
	assert.ok(events.some(({ type, title }) => type === "opened" && title === "Acme issue"));
	assert.equal(events.some(({ title }) => title.includes("Birch")), false);

	// The same lookups from the other workspace find nothing of Acme's contact.
	assert.equal(await db.models.Contact.findOne({ _id: a.contact._id, workspaceId: b.workspace._id }), null);
	assert.equal((await db.models.Message.find({ contactId: a.contact._id, workspaceId: b.workspace._id }).lean()).length, 0);
});

test("deleting a contact from its page erases the same things as from the list", async () => {
	const { deleteContact } = await import("@/app/(app)/contacts/actions");
	await loginAs(b.owner);
	assert.equal((await deleteContact(id(a.contact))).error, "Contact not found", "another workspace can't");
	await loginAs(a.owner);
	assert.deepEqual(await deleteContact(id(a.contact)), { ok: true });
	assert.equal(await db.models.Contact.countDocuments({ _id: a.contact._id }), 0);
});
