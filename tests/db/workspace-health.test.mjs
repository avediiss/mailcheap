import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loginAs, makeTenant, startDb } from "./helpers.mjs";

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
	const { clearHealthThrottle } = await import("@/lib/workspace-health-server");
	clearHealthThrottle();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
});

const id = (doc) => String(doc._id);
const ago = (hours) => new Date(Date.now() - hours * 3600_000);

function sends(tenant, { count, bounced = 0, complained = 0, hoursAgo = 2, kind = "welcome" }) {
	return db.models.Message.insertMany(
		Array.from({ length: count }, (_, index) => ({
			kind, workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email: `r${index}-${Math.random()}@example.com`, status: "sent", sentAt: ago(hoursAgo),
			...(index < bounced && { bouncedAt: ago(hoursAgo) }),
			...(index >= bounced && index < bounced + complained && { complainedAt: ago(hoursAgo) }),
		}))
	);
}

test("a workspace past the account limits is blocked: suspended, sends paused, owners and platform told, recorded", async () => {
	const { evaluateWorkspaceHealth } = await import("@/lib/workspace-health-server");
	await sends(a, { count: 200, bounced: 14 });
	const sending = await db.models.Campaign.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, subject: "Big send", status: "sending", format: "markdown", markdown: "x" });
	await sends(b, { count: 200, bounced: 14 });

	const reason = await evaluateWorkspaceHealth(a.workspace._id, { force: true });
	assert.match(reason, /7\.0% of the last 7 days' emails bounced/);
	const workspace = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(workspace.status, "suspended");
	assert.equal(workspace.blockReason, reason);
	assert.ok(workspace.blockedAt);
	assert.equal((await db.models.Campaign.findById(sending._id)).status, "paused");
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.blocked" }), 1);
	const mails = globalThis.__sentEmails.filter(({ subject }) => /Sending blocked/.test(subject)).map(({ to }) => to);
	assert.ok(mails.includes(a.owner.email), "the owner is told");
	assert.ok(mails.includes(process.env.ADMIN_EMAIL) || mails.includes(root.email), "so is the platform");

	// Asking again changes nothing and says nothing more.
	assert.equal(await evaluateWorkspaceHealth(a.workspace._id, { force: true }), null);
	assert.equal(await db.models.AuditLog.countDocuments({ action: "workspace.blocked" }), 1);
	// Another workspace is judged on its own numbers: Birch is at the same rate but hasn't been checked.
	assert.equal((await db.models.Workspace.findById(b.workspace._id)).status, "active");
});

test("good numbers, test emails and old sends never block anyone", async () => {
	const { evaluateWorkspaceHealth } = await import("@/lib/workspace-health-server");
	await sends(a, { count: 300, bounced: 6, complained: 1 });
	await sends(a, { count: 100, bounced: 100, kind: "test" });
	await sends(a, { count: 100, bounced: 100, hoursAgo: 24 * 8 });
	assert.equal(await evaluateWorkspaceHealth(a.workspace._id, { force: true }), null);
	assert.equal((await db.models.Workspace.findById(a.workspace._id)).status, "active");
});

test("the check is throttled to once a minute unless forced", async () => {
	const { evaluateWorkspaceHealth } = await import("@/lib/workspace-health-server");
	assert.equal(await evaluateWorkspaceHealth(a.workspace._id), null);
	await sends(a, { count: 200, bounced: 30 });
	assert.equal(await evaluateWorkspaceHealth(a.workspace._id), null, "checked a moment ago");
	assert.ok(await evaluateWorkspaceHealth(a.workspace._id, { force: true }));
});

test("resuming clears the block and counts afresh from that moment, so the old bounces don't block it again", async () => {
	const { evaluateWorkspaceHealth } = await import("@/lib/workspace-health-server");
	const { setWorkspaceStatus } = await import("@/app/(app)/platform/actions");
	await sends(a, { count: 200, bounced: 30 });
	await evaluateWorkspaceHealth(a.workspace._id, { force: true });
	assert.equal((await db.models.Workspace.findById(a.workspace._id)).status, "suspended");

	await loginAs(root);
	process.env.REQUIRE_ADMIN_2FA = "false";
	assert.deepEqual(await setWorkspaceStatus(id(a.workspace), "active"), { ok: true });
	const resumed = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(resumed.status, "active");
	assert.equal(resumed.blockReason, undefined);
	assert.equal(resumed.blockedAt, undefined);
	assert.ok(resumed.healthResetAt);

	assert.equal(await evaluateWorkspaceHealth(a.workspace._id, { force: true }), null, "the earlier bounces are not counted");
	await new Promise((resolve) => setTimeout(resolve, 5));
	await sends(a, { count: 200, bounced: 30, hoursAgo: 0 });
	assert.ok(await evaluateWorkspaceHealth(a.workspace._id, { force: true }), "new trouble blocks it again");
});

test("a bounce arriving from SES can be the one that tips it over, and the next batch of a blocked workspace sends nothing", async () => {
	const { handleSesEvent } = await import("@/lib/ses-events");
	const { sendMessageBatch } = await import("@/lib/sending");
	await sends(a, { count: 199, bounced: 10 });
	const last = await db.models.Message.create({ kind: "welcome", workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "tip@example.com", status: "sent", sentAt: ago(1), sesMessageId: "ses-tip-1" });
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { email: "tip@example.com" } });

	await handleSesEvent({
		eventType: "Bounce",
		mail: { timestamp: new Date().toISOString(), messageId: "ses-tip-1", destination: ["tip@example.com"], tags: { message_id: [id(last)], kind: ["welcome"] } },
		bounce: { bounceType: "Permanent", bounceSubType: "General", timestamp: new Date().toISOString(), bouncedRecipients: [{ emailAddress: "tip@example.com" }] },
	});
	const workspace = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(workspace.status, "suspended", "10 of 200 is exactly 5%; the eleventh tips it over");
	assert.match(workspace.blockReason, /5\.5%/);

	// Nothing more goes out for it, and the queued email says why.
	const queued = await db.models.Message.create({ kind: "welcome", workspaceId: a.workspace._id, newsletterId: a.newsletter._id, contactId: a.contact._id, email: "reader@acme-readers.test", status: "queued" });
	const result = await sendMessageBatch([id(queued)]);
	assert.equal(result.sent, 0);
	assert.match((await db.models.Message.findById(queued._id)).error, /suspended/);
	assert.equal(globalThis.__sentEmails.filter(({ to }) => to === "reader@acme-readers.test").length, 0);
});
