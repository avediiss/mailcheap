import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let root;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	const { clearSendPlanCache } = await import("@/lib/send-plan-server");
	clearSendPlanCache();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
	await db.models.Workspace.updateMany({}, { $set: { sendingTrust: { isTrusted: true } } });
});

const id = (doc) => String(doc._id);
const PHISHING = "Your account has been suspended. [Verify your password](https://acme-login.example.net/restore) today.";
const FINE = "A normal issue with [a link](https://acme.test/blog) and some words.";
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};

async function setBody(tenant, markdown, subject = "Weekly update") {
	await db.models.Campaign.updateOne({ _id: tenant.campaign._id }, { $set: { markdown, subject } });
}
async function queue(tenant) {
	const { queueCampaign } = await import("@/lib/sending");
	return queueCampaign(id(tenant.campaign));
}
async function decide(campaignId, decision, note) {
	const { decideReviewAction } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	return decideReviewAction(campaignId, decision, note);
}

test("an ordinary issue is never held, and a flagged one waits for review with the reason, and the platform is told", async () => {
	await setBody(a, FINE);
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { lastSentAt: new Date() } });
	assert.equal((await queue(a)).recipients, 1);
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).review.status, undefined, "nothing recorded for a clean issue");

	await setBody(b, PHISHING);
	await assert.rejects(queue(b), (error) => error.name === "ReviewError" && /needs a quick review by the platform team/.test(error.message));
	const campaign = await db.models.Campaign.findById(b.campaign._id);
	assert.equal(campaign.status, "draft", "nothing was queued");
	assert.equal(campaign.review.status, "pending");
	assert.match(campaign.review.reasons.join(" "), /verify or hand over account, password or payment details/);
	assert.equal(await db.models.Message.countDocuments({ campaignId: b.campaign._id }), 0);
	assert.ok(globalThis.__sentEmails.some(({ subject }) => /Issue waiting for review/.test(subject)), "the platform is told");

	// Trying again says it is waiting, and does not stack up requests.
	await assert.rejects(queue(b), /waiting for a quick review/);
	assert.equal((await db.models.Campaign.findById(b.campaign._id)).review.status, "pending");
});

test("approving lets exactly that text go out, an edit asks again, and a turned-down issue says why", async () => {
	await setBody(a, PHISHING);
	await assert.rejects(queue(a), /review/);
	assert.deepEqual(await decide(id(a.campaign), "approved"), { ok: true });
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).review.status, "approved");
	assert.ok(globalThis.__sentEmails.some(({ subject, to }) => /was approved/.test(subject) && to === a.owner.email), "the owner is told");
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { lastSentAt: new Date() } });
	assert.equal((await queue(a)).recipients, 1, "approved text goes out");

	// An edit after approval is a different text: it is scanned and held again.
	await db.models.Campaign.updateOne({ _id: b.campaign._id }, { $set: { markdown: PHISHING, subject: "Weekly update" } });
	await assert.rejects(queue(b), /review/);
	await decide(id(b.campaign), "approved");
	await setBody(b, `${PHISHING} Also: [paypal.com](https://evil.test/p)`);
	await assert.rejects(queue(b), /review/);
	assert.equal((await db.models.Campaign.findById(b.campaign._id)).review.status, "pending", "pending again for the new text");
});

test("turning down needs a reason, the sender reads it, and a stale decision can't be made", async () => {
	await setBody(a, PHISHING);
	await assert.rejects(queue(a), /review/);
	assert.match((await decide(id(a.campaign), "rejected", "  ")).error, /Say why/);
	assert.deepEqual(await decide(id(a.campaign), "rejected", "The link goes to a lookalike login page."), { ok: true });
	await assert.rejects(queue(a), /can't send it: The link goes to a lookalike login page\. Change it and try again\./);
	assert.ok(globalThis.__sentEmails.some(({ subject }) => /wasn't approved/.test(subject)));
	assert.equal(await db.models.AuditLog.countDocuments({ action: "review.rejected", workspaceId: a.workspace._id }), 1);

	// Deciding on something that isn't waiting.
	assert.match((await decide(id(a.campaign), "approved")).error, /isn't waiting/);
	// Edited while it waited: the decision would not be about the text that was flagged.
	await setBody(b, PHISHING);
	await assert.rejects(queue(b), /review/);
	await setBody(b, `${PHISHING} (edited)`);
	assert.match((await decide(id(b.campaign), "approved")).error, /edited since it was flagged/);
	assert.equal((await db.models.Campaign.findById(b.campaign._id)).review.status, "pending");
});

test("only platform administrators decide, and the waiting list shows only what is waiting", async () => {
	const { decideReviewAction } = await import("@/app/(app)/platform/actions");
	const { listPendingReviews } = await import("@/lib/content-review");
	await setBody(a, PHISHING, "Account notice");
	await assert.rejects(queue(a), /review/);
	await loginAs(a.owner);
	assert.equal((await catching(() => decideReviewAction(id(a.campaign), "approved"))).redirectTo, "/");
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).review.status, "pending");

	let pending = await listPendingReviews();
	assert.equal(pending.length, 1);
	assert.equal(pending[0].subject, "Account notice");
	assert.equal(pending[0].workspaceName, "Acme");
	assert.equal(pending[0].newsletterName, "Acme weekly");
	assert.match(pending[0].reasons[0], /account, password or payment/);
	await decide(id(a.campaign), "approved");
	pending = await listPendingReviews();
	assert.equal(pending.length, 0);
});

test("scheduling a flagged issue is refused now, while the sender can still change it", async () => {
	const { scheduleCampaign } = await import("@/app/(app)/campaigns/actions");
	await setBody(a, PHISHING);
	await loginAs(a.owner);
	const result = await scheduleCampaign(id(a.campaign), { scheduledAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
	assert.match(result.error, /needs a quick review/);
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "draft");
});

test("welcome, confirmation and series emails that look like a scam can't be saved", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	const base = { id: id(a.newsletter), name: "Weekly", slug: a.newsletter.slug, fromEmail: a.newsletter.fromEmail, replyTo: "info@acme.test" };
	const scam = await saveNewsletter(null, form({ ...base, welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeMarkdown: PHISHING }));
	assert.match(scam.error, /Welcome email: It asks readers to verify or hand over account, password or payment details\. It can't be used as it is/);
	const fine = await saveNewsletter(null, form({ ...base, welcomeEnabled: "on", welcomeSubject: "Welcome", welcomeMarkdown: "Thanks for joining, here is what to expect." }));
	assert.equal(fine.ok, true);
	// Switched off, it isn't scanned: nothing will be sent.
	const off = await saveNewsletter(null, form({ ...base, welcomeSubject: "Welcome", welcomeMarkdown: PHISHING }));
	assert.equal(off.ok, true);
});
