import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	const { clearSendPlanCache } = await import("@/lib/send-plan-server");
	const { clearHealthThrottle } = await import("@/lib/workspace-health-server");
	clearSendPlanCache();
	clearHealthThrottle();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	// The tenant's own contact would count as a recipient: this file counts exactly the ones it makes.
	await db.models.Contact.deleteMany({});
});

const id = (doc) => String(doc._id);
const HOUR = 3600;

function addContacts(count, fields = {}) {
	return db.models.Contact.insertMany(
		Array.from({ length: count }, (_, index) => ({
			workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: `u${index}@acme-readers.io`, status: "active", source: "test",
			subscribedAt: new Date(Date.now() - index * 1000), ...fields,
		}))
	);
}
const trust = (fields) => db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { sendingTrust: fields } });
const calls = () => globalThis.__qstashCalls;
const batchesWithDelay = () => calls().filter(({ body }) => body?.messageIds).map(({ body, delay }) => ({ size: body.messageIds.length, delay: delay ?? 0 }));
const sentTo = () => globalThis.__sentEmails.map(({ to }) => to);

async function send() {
	const { queueCampaign } = await import("@/lib/sending");
	return queueCampaign(id(a.campaign));
}

test("a new sender's first send is spread over three days at 200 a day, and the people who go on later days wait for them", async () => {
	await addContacts(600, { lastSentAt: new Date(Date.now() - 86400_000) });
	const { secondsUntilNextUtcDay } = await import("@/lib/send-plan");
	const result = await send();
	assert.equal(result.recipients, 600);
	const requests = batchesWithDelay();
	assert.equal(requests.reduce((sum, { size }) => sum + size, 0), 600);
	assert.deepEqual(requests.slice(0, 4).map(({ delay }) => delay), [0, 0, 0, 0], "the first 200 go now");
	const tomorrow = secondsUntilNextUtcDay();
	for (const { delay } of requests.slice(4, 8)) assert.ok(Math.abs(delay - tomorrow) <= 5, `tomorrow's 200 wait for midnight (${delay} vs ${tomorrow})`);
	for (const { delay } of requests.slice(8)) assert.ok(Math.abs(delay - (tomorrow + 86400)) <= 5, "and the day after's wait another day");
	assert.match(result.notes.join(" "), /200 emails a day.*over 3 days: 200 today/);
	assert.deepEqual((await db.models.Campaign.findById(a.campaign._id)).sendNotes, result.notes);
});

test("more people than three days allow: the most engaged go, the rest wait for 'Send to more', and the person is told", async () => {
	await addContacts(900, { lastSentAt: new Date(Date.now() - 86400_000) });
	const result = await send();
	assert.equal(result.recipients, 600, "200 today plus two more days of 200");
	const campaign = await db.models.Campaign.findById(a.campaign._id);
	assert.equal(campaign.audienceLimit, 600);
	assert.match(campaign.sendNotes[0], /goes to the 600 most engaged of 900 people for now/);
	assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id }), 600);
});

test("a trusted workspace sends at once, and the platform can set its own daily amount", async () => {
	await addContacts(900, { lastSentAt: new Date(Date.now() - 86400_000) });
	await trust({ isTrusted: true });
	await send();
	assert.deepEqual(batchesWithDelay().map(({ delay }) => delay).filter((delay) => delay > 0), [], "no delays at all");
	assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id }), 900);

	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	await db.models.Contact.deleteMany({});
	await addContacts(900, { lastSentAt: new Date(Date.now() - 86400_000) });
	await trust({ dailyCap: 100 });
	const result = await send();
	assert.equal(result.recipients, 300, "100 a day for three days");
});

test("a send to many people who have never had an email from you sends a slice first and holds the rest 3 hours", async () => {
	await addContacts(1000);
	await trust({ isTrusted: true });
	const result = await send();
	const requests = batchesWithDelay();
	assert.deepEqual(requests.slice(0, 4).map(({ delay }) => delay), [0, 0, 0, 0], "200 first");
	assert.ok(requests.slice(4).every(({ delay }) => delay === 3 * HOUR), "the other 800 wait exactly 3 hours");
	assert.equal(requests.reduce((sum, { size }) => sum + size, 0), 1000);
	assert.match(result.notes.join(" "), /1,000 of these people have never had an email from you\. The first 200 go out now/);
});

test("people who already had an email from you are never held back, and a small send isn't sliced", async () => {
	await trust({ isTrusted: true });
	await addContacts(500, { lastSentAt: new Date(Date.now() - 86400_000) });
	await send();
	assert.ok(batchesWithDelay().every(({ delay }) => delay === 0), "everyone goes together");

	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	await db.models.Contact.deleteMany({});
	await trust({ isTrusted: true });
	await addContacts(150);
	await send();
	assert.ok(batchesWithDelay().every(({ delay }) => delay === 0), "150 new people is under the threshold");
});

test("the held-back part does not go if the first slice went badly: the campaign pauses instead", async () => {
	await addContacts(1000);
	await trust({ isTrusted: true });
	await send();
	const held = calls().filter(({ delay }) => delay === 3 * HOUR)[0].body.messageIds;
	// Three hours later the first slice has bounced.
	await db.models.Campaign.updateOne({ _id: a.campaign._id }, { $set: { "stats.sent": 200, "stats.bounced": 12 } });
	const { sendMessageBatch } = await import("@/lib/sending");
	globalThis.__sentEmails.length = 0;
	const result = await sendMessageBatch(held);
	assert.equal(result.sent, 0);
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "paused");
	assert.equal(sentTo().filter((to) => to.endsWith("@acme-readers.io")).length, 0, "no reader got anything (the alerts to the owner and platform are not readers)");
	assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id, status: "queued" }), 1000, "nothing was claimed");
});

test("a batch over the day's allowance sends what is left and puts the rest back for tomorrow", async () => {
	await addContacts(5, { lastSentAt: new Date(Date.now() - 86400_000) });
	await trust({ dailyCap: 3 });
	await db.models.Campaign.updateOne({ _id: a.campaign._id }, { $set: { status: "sending" } });
	const contacts = await db.models.Contact.find().sort({ email: 1 });
	const messages = await db.models.Message.insertMany(
		contacts.map((contact) => ({ kind: "campaign", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, contactId: contact._id, email: contact.email, status: "queued" }))
	);
	const { sendMessageBatch } = await import("@/lib/sending");
	const { secondsUntilNextUtcDay } = await import("@/lib/send-plan");
	globalThis.__sentEmails.length = 0;
	const result = await sendMessageBatch(messages.map(id));
	assert.equal(result.sent, 3);
	assert.equal(result.skipped, 2);
	assert.equal(sentTo().length, 3);
	assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id, status: "queued" }), 2, "the other two wait");
	const deferred = calls().filter(({ via }) => via === "batchJSON");
	assert.equal(deferred.length, 1);
	assert.equal(deferred[0].body.messageIds.length, 2);
	assert.ok(Math.abs(deferred[0].delay - secondsUntilNextUtcDay()) <= 5);
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "sending", "not finished while some wait");

	// A second batch the same day sends nothing more, and defers the same two again.
	globalThis.__qstashCalls.length = 0;
	const again = await sendMessageBatch(deferred[0].body.messageIds);
	assert.equal(again.sent, 0);
	assert.equal(calls().filter(({ via }) => via === "batchJSON")[0].body.messageIds.length, 2);
});

test("welcome and confirmation emails are not held by the daily allowance", async () => {
	await trust({ dailyCap: 1 });
	const [contact] = await addContacts(1);
	const { queueWelcomeEmail } = await import("@/lib/sending");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { welcome: { enabled: true, subject: "Welcome", markdown: "Hi there" } } });
	const newsletter = await db.models.Newsletter.findById(a.newsletter._id).lean();
	await db.models.Message.create({ kind: "welcome", workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "someone@x.test", status: "sent", sentAt: new Date() });
	const result = await queueWelcomeEmail({ newsletter, contact: contact.toObject() });
	assert.equal(result.sent, 1, "sent although today's allowance of 1 is already used");
});

test("sending to more is held to the allowance too, and the preview says what a send would do", async () => {
	await addContacts(1000, { lastSentAt: new Date(Date.now() - 86400_000) });
	await trust({ dailyCap: 100 });
	const { getSendPlanPreview, sendToMoreContacts } = await import("@/lib/sending");
	let preview = await getSendPlanPreview(id(a.campaign), { audienceLimit: 100 });
	assert.deepEqual(preview.notes, []);
	preview = await getSendPlanPreview(id(a.campaign));
	assert.match(preview.notes.join(" "), /100 emails a day/);

	await send();
	await db.models.Campaign.updateOne({ _id: a.campaign._id }, { $set: { status: "sent" } });
	const more = await sendToMoreContacts(id(a.campaign), undefined);
	// Everyone left was asked for, but only so many fit in the next three days: 300 went first, 300 more may follow.
	assert.equal(more.added, 300);
	assert.equal(more.recipients, 600);
});
