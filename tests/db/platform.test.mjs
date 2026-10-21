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
	a = await makeTenant(db.models, { name: "Acme", slug: "acme", withEditor: true });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
});

const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};
const sent = () => globalThis.__sentEmails;

async function setLimits(tenant, limits) {
	await db.models.Workspace.updateOne({ _id: tenant.workspace._id }, { $set: { limits } });
}
async function addContacts(tenant, count, status = "active") {
	await db.models.Contact.insertMany(
		Array.from({ length: count }, (_, index) => ({ workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email: `extra${index}-${status}@${tenant.domain}`, status, source: "test" }))
	);
}
async function addSent(tenant, count, fields = {}) {
	await db.models.Message.insertMany(
		Array.from({ length: count }, () => ({ kind: "welcome", workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email: "x@example.com", status: "sent", sentAt: new Date(), ...fields }))
	);
}

test("only the platform owner can use the console actions: everyone else is sent home and nothing changes", async () => {
	const actions = await import("@/app/(app)/platform/actions");
	for (const user of [a.owner, a.editor]) {
		await loginAs(user);
		for (const run of [
			() => actions.createWorkspace(null, form({ name: "Sneaky", ownerEmail: "x@example.com" })),
			() => actions.updateWorkspace(null, form({ id: id(b.workspace), name: "Hacked" })),
			() => actions.setWorkspaceStatus(id(b.workspace), "suspended"),
			() => actions.openWorkspace(id(b.workspace)),
		]) {
			assert.equal((await catching(run)).redirectTo, "/");
		}
	}
	assert.equal(await db.models.Workspace.countDocuments(), 2);
	assert.equal((await db.models.Workspace.findById(b.workspace._id)).name, "Birch");
	assert.equal((await db.models.Workspace.findById(b.workspace._id)).status, "active");
	assert.equal(await db.models.AuditLog.countDocuments(), 0);
});

test("creating a workspace: a unique slug, its limits, an invitation to its first owner, and a record of it", async () => {
	const { createWorkspace } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	const result = await createWorkspace(null, form({ name: "Acme", ownerEmail: "Boss@Client.com", contacts: "500", emailsPerMonth: "5,000", newsletters: "" }));
	assert.equal(result.ok, true);
	assert.equal(result.emailed, true);
	assert.match(result.link, /\/invite\//);

	const created = await db.models.Workspace.findById(result.workspaceId);
	assert.equal(created.slug, "acme-2", "the first 'acme' is taken");
	assert.equal(created.status, "active");
	assert.deepEqual({ ...created.limits.toObject() }, { contacts: 500, emailsPerMonth: 5000, newsletters: null });

	const invitation = await db.models.Invitation.findOne({ workspaceId: created._id });
	assert.equal(invitation.email, "boss@client.com");
	assert.equal(invitation.role, "owner");
	assert.ok(sent().some(({ to, text }) => to === "boss@client.com" && text.includes(result.link)));
	const audit = await db.models.AuditLog.findOne({ workspaceId: created._id, action: "workspace.created" });
	assert.equal(audit.actorEmail, "root@platform.test");
});

test("a bad form creates nothing", async () => {
	const { createWorkspace } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	for (const [fields, pattern] of [
		[{ name: "A", ownerEmail: "x@example.com" }, /name of 2 to 80/],
		[{ name: "Fine", ownerEmail: "not-an-email" }, /owner's email/],
		[{ name: "Fine", ownerEmail: "x@example.com", contacts: "lots" }, /^Contacts: /],
		[{ name: "Fine", ownerEmail: "x@example.com", emailsPerMonth: "-5" }, /^Emails per month: /],
	]) {
		assert.match((await createWorkspace(null, form(fields))).error, pattern);
	}
	assert.equal(await db.models.Workspace.countDocuments(), 2);
	assert.equal(await db.models.Invitation.countDocuments(), 0);
});

test("when the first owner's invitation can't be made the workspace still exists and says so", async () => {
	const { createWorkspace } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	await db.models.Invitation.collection.createIndex({ x: 1 });
	const result = await createWorkspace(null, form({ name: "Fresh", ownerEmail: a.owner.email }));
	assert.equal(result.ok, true);
	// The address already belongs to a person with an account: the invitation is still made, to be accepted by logging in.
	assert.equal(result.invitationError, null);
	assert.ok(result.link);
});

test("editing a workspace changes its name and limits, and records each", async () => {
	const { updateWorkspace } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	assert.deepEqual(await updateWorkspace(null, form({ id: id(a.workspace), name: "Acme Studio", contacts: "100", emailsPerMonth: "", newsletters: "2" })), { ok: true });
	const after = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(after.name, "Acme Studio");
	assert.deepEqual({ ...after.limits.toObject() }, { contacts: 100, emailsPerMonth: null, newsletters: 2 });
	const actions = (await db.models.AuditLog.find({ workspaceId: a.workspace._id }).lean()).map(({ action }) => action).toSorted();
	assert.deepEqual(actions, ["workspace.limits", "workspace.renamed"]);

	await updateWorkspace(null, form({ id: id(a.workspace), name: "Acme Studio", contacts: "100", newsletters: "2" }));
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id }), 2, "saving without changes records nothing");
	assert.match((await updateWorkspace(null, form({ id: id(a.workspace), name: "X" }))).error, /name of 2 to 80/);
	assert.equal((await updateWorkspace(null, form({ id: "nope", name: "Fine" }))).error, "Workspace not found");
});

test("suspending stops a workspace's API and signups, resuming brings them back, and both are recorded", async () => {
	const { setWorkspaceStatus } = await import("@/app/(app)/platform/actions");
	const contactsRoute = await import("@/app/api/v1/contacts/route");
	const signup = (email) =>
		contactsRoute.POST(new Request("https://mailcheap.test/api/v1/contacts", { method: "POST", headers: { authorization: `Bearer ${a.apiKeySecret}`, "content-type": "application/json" }, body: JSON.stringify({ newsletter: "acme-weekly", email }) }));

	await loginAs(root);
	assert.deepEqual(await setWorkspaceStatus(id(a.workspace), "suspended"), { ok: true });
	assert.equal((await signup("one@example.com")).status, 403);
	assert.deepEqual(await setWorkspaceStatus(id(a.workspace), "active"), { ok: true });
	assert.equal((await signup("one@example.com")).status, 201);

	const log = (await db.models.AuditLog.find({ workspaceId: a.workspace._id }).sort({ createdAt: 1 }).lean()).map(({ action }) => action);
	assert.deepEqual(log, ["workspace.suspended", "workspace.resumed"]);
	assert.equal((await setWorkspaceStatus(id(a.workspace), "deleted")).error, "Workspace not found");
});

test("stepping into a workspace is recorded for the platform owner, but not for their own", async () => {
	const { openWorkspace } = await import("@/app/(app)/platform/actions");
	const { switchWorkspace } = await import("@/app/(app)/workspaces/actions");
	const { WORKSPACE_COOKIE } = await import("@/lib/workspace");
	await db.models.Membership.create({ userId: root._id, workspaceId: b.workspace._id, role: "owner" });

	await loginAs(root);
	assert.equal((await catching(() => openWorkspace(id(a.workspace)))).redirectTo, "/");
	assert.equal(globalThis.__testRequest.cookies.get(WORKSPACE_COOKIE), id(a.workspace));
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.opened" }), 1);

	await switchWorkspace(id(b.workspace));
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: b.workspace._id }), 0, "a member isn't 'acting as'");
	await switchWorkspace(id(a.workspace));
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.opened" }), 2);
});

test("the console's numbers: contacts that count, emails this month without test mail, and health once there is enough sending", async () => {
	const { listWorkspaceSummaries, getPlatformTotals } = await import("@/lib/platform");
	await addContacts(a, 4);
	await addContacts(a, 2, "unsubscribed");
	await addSent(a, 60);
	await addSent(a, 3, { kind: "test" });
	await addSent(a, 2, { sentAt: new Date(Date.now() - 60 * 86400_000) });
	await db.models.Message.updateMany({ workspaceId: a.workspace._id, kind: "welcome", sentAt: { $gte: new Date(Date.now() - 86400_000) } }, {});
	const first = await db.models.Message.find({ workspaceId: a.workspace._id, kind: "welcome" }).limit(3);
	await db.models.Message.updateMany({ _id: { $in: first.map(({ _id }) => _id) } }, { $set: { bouncedAt: new Date() } });
	await setLimits(a, { contacts: 10, emailsPerMonth: 100, newsletters: null });

	const rows = await listWorkspaceSummaries();
	const acme = rows.find(({ slug }) => slug === "acme");
	const birch = rows.find(({ slug }) => slug === "birch");
	assert.equal(acme.contacts, 5, "1 from the fixture + 4, not the unsubscribed");
	assert.equal(acme.contactsTotal, 7);
	assert.equal(acme.members, 2);
	assert.equal(acme.newsletters, 1);
	assert.equal(acme.emailsThisMonth, 60, "no test mail, nothing from two months ago");
	assert.equal(acme.sent30, 60);
	assert.equal(acme.bounced30, 3);
	assert.equal(acme.health, "bad", "5% bounced is past the 2% pause line");
	assert.equal(acme.contactsMeter.state, "ok");
	assert.equal(acme.emailsMeter.ratio, 0.6);
	assert.equal(birch.health, "unknown");
	assert.equal(birch.emailsThisMonth, 0);

	const totals = getPlatformTotals(rows);
	assert.equal(totals.workspaces, 2);
	assert.equal(totals.emailsThisMonth, 60);
	assert.equal(totals.contacts, 6);
});

test("a workspace's own usage and limits", async () => {
	const { getWorkspaceUsage } = await import("@/lib/quota");
	await setLimits(a, { contacts: 2, emailsPerMonth: 10, newsletters: 1 });
	await addContacts(a, 1);
	await addSent(a, 4);
	const usage = await getWorkspaceUsage(a.workspace._id);
	assert.deepEqual(usage.used, { contacts: 2, emailsPerMonth: 4, newsletters: 1 });
	assert.equal(usage.meters.contacts.state, "full");
	assert.equal(usage.meters.newsletters.state, "full");
	assert.equal(usage.meters.emailsPerMonth.state, "ok");
	assert.equal((await getWorkspaceUsage(b.workspace._id)).meters.contacts.state, "unlimited");
});

test("the contact limit: signups and the API stop at the limit, people already there can still sign up again", async () => {
	const contactsRoute = await import("@/app/api/v1/contacts/route");
	const signup = (email) =>
		contactsRoute.POST(new Request("https://mailcheap.test/api/v1/contacts", { method: "POST", headers: { authorization: `Bearer ${a.apiKeySecret}`, "content-type": "application/json" }, body: JSON.stringify({ newsletter: "acme-weekly", email }) }));
	await setLimits(a, { contacts: 2, emailsPerMonth: null, newsletters: null });

	assert.equal((await signup("new1@example.com")).status, 201, "the second contact fits");
	const blocked = await signup("new2@example.com");
	assert.equal(blocked.status, 403);
	assert.match((await blocked.json()).error, /reached its contact limit/);
	assert.equal(await db.models.Contact.countDocuments({ email: "new2@example.com" }), 0);
	assert.equal((await signup("new1@example.com")).status, 200, "already there: fine");

	await db.models.Contact.updateOne({ email: "new1@example.com" }, { $set: { status: "unsubscribed" } });
	assert.equal((await signup("new2@example.com")).status, 201, "someone who left frees a place");
});

test("the contact limit on the public signup form closes it without saying why", async () => {
	const archive = await import("@/app/archive/actions");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveEnabled: true } });
	await setLimits(a, { contacts: 1, emailsPerMonth: null, newsletters: null });
	const result = await archive.subscribe(null, form({ newsletter: "acme-weekly", email: "visitor@example.com" }));
	assert.equal(result.error, "This newsletter is not taking signups right now");
	assert.equal(await db.models.Contact.countDocuments({ email: "visitor@example.com" }), 0);
});

test("the contact limit on manual add and CSV import: partial import, with the rest reported", async () => {
	const actions = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);
	await setLimits(a, { contacts: 3, emailsPerMonth: null, newsletters: null });
	const rows = ["a", "b", "c", "d", "e"].map((name) => ({ email: `${name}@import.test`, status: "active" }));

	const result = await actions.importContacts({ newsletterId: id(a.newsletter), rows });
	assert.equal(result.created, 2, "3 minus the contact already there");
	assert.equal(result.skippedOverLimit, 3);
	assert.equal(await db.models.Contact.countDocuments({ workspaceId: a.workspace._id }), 3);

	assert.deepEqual(await actions.addContact({ newsletterId: id(a.newsletter), email: "late@example.com" }), { error: "This workspace has reached its contact limit." });
	const again = await actions.importContacts({ newsletterId: id(a.newsletter), rows: [rows[0], { email: "leaver@import.test", status: "unsubscribed" }] });
	assert.equal(again.skippedOverLimit, 0, "people already there and people who left cost no room");
	assert.equal(again.created, 1);
});

test("the newsletter limit", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	await setLimits(a, { contacts: null, emailsPerMonth: null, newsletters: 1 });
	const result = await saveNewsletter(null, form({ name: "Second", slug: "acme-second", fromEmail: "hi@acme.test" }));
	assert.match(result.error, /limit of 1 newsletters/);
	assert.equal(await db.models.Newsletter.countDocuments({ workspaceId: a.workspace._id }), 1);
});

test("the monthly email limit: a send that doesn't fit is refused before anything is queued", async () => {
	process.env.QSTASH_TOKEN = "test-token";
	try {
		const { queueCampaign } = await import("@/lib/sending");
		await addContacts(a, 4);
		await addSent(a, 6);
		await setLimits(a, { contacts: null, emailsPerMonth: 8, newsletters: null });

		await assert.rejects(queueCampaign(id(a.campaign)), /needs 5 emails, but only 2 are left of this month's 8/);
		assert.equal(await db.models.Message.countDocuments({ campaignId: a.campaign._id }), 0, "nothing was queued");
		assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "draft");

		await setLimits(a, { contacts: null, emailsPerMonth: 6, newsletters: null });
		await assert.rejects(queueCampaign(id(a.campaign)), /used all 6 emails/);
	} finally {
		delete process.env.QSTASH_TOKEN;
	}
});

test("the monthly email limit also stops a send that is already under way, pausing it and telling the owners", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await db.models.Campaign.updateOne({ _id: a.campaign._id }, { $set: { status: "sending" } });
	await addContacts(a, 3);
	const contacts = await db.models.Contact.find({ workspaceId: a.workspace._id }).lean();
	const messages = await db.models.Message.insertMany(
		contacts.map((contact) => ({ kind: "campaign", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, contactId: contact._id, email: contact.email, status: "queued" }))
	);
	await addSent(a, 1);
	await setLimits(a, { contacts: null, emailsPerMonth: 3, newsletters: null });

	const result = await sendMessageBatch(messages.map(({ _id }) => String(_id)));
	assert.equal(result.sent, 2, "1 already used + 2 sent = the 3 allowed");
	assert.equal((await db.models.Message.countDocuments({ campaignId: a.campaign._id, status: "queued" })), 2, "the rest wait, untouched");
	assert.equal((await db.models.Campaign.findById(a.campaign._id)).status, "paused");
	const alert = sent().find(({ subject }) => /Campaign paused/.test(subject));
	assert.ok(alert.text.includes("monthly email limit"));
	assert.ok(sent().some(({ to }) => to === "owner@acme.test"));
});

test("welcome and confirmation emails over the monthly limit fail with a reason instead of sending", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await addSent(a, 2);
	await setLimits(a, { contacts: null, emailsPerMonth: 2, newsletters: null });
	const message = await db.models.Message.create({ kind: "welcome", workspaceId: a.workspace._id, newsletterId: a.newsletter._id, contactId: a.contact._id, email: a.contact.email });
	assert.equal((await sendMessageBatch([id(message)])).sent, 0);
	const stored = await db.models.Message.findById(message._id);
	assert.equal(stored.status, "failed");
	assert.match(stored.error, /monthly email limit is reached/);
	assert.ok(!sent().some(({ to }) => to === a.contact.email));
});

test("another workspace's usage never counts against this one", async () => {
	const { sendMessageBatch } = await import("@/lib/sending");
	await addSent(b, 50);
	await setLimits(a, { contacts: null, emailsPerMonth: 5, newsletters: null });
	await db.models.Campaign.updateOne({ _id: a.campaign._id }, { $set: { status: "sending" } });
	const message = await db.models.Message.create({ kind: "campaign", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, contactId: a.contact._id, email: a.contact.email, status: "queued" });
	assert.equal((await sendMessageBatch([id(message)])).sent, 1);
});

test("activity listings show a workspace's own records, newest first", async () => {
	const { listAudit, recordAudit } = await import("@/lib/audit");
	await recordAudit({ actor: { userId: root._id, email: root.email }, workspaceId: a.workspace._id, action: "workspace.created" });
	await new Promise((resolve) => setTimeout(resolve, 5));
	await recordAudit({ actor: { userId: root._id, email: root.email }, workspaceId: a.workspace._id, action: "workspace.suspended" });
	await recordAudit({ actor: { userId: root._id, email: root.email }, workspaceId: b.workspace._id, action: "workspace.created" });
	const rows = await listAudit({ workspaceId: a.workspace._id });
	assert.deepEqual(rows.map(({ action }) => action), ["workspace.suspended", "workspace.created"]);
	assert.equal(rows[0].actorEmail, "root@platform.test");
	assert.equal((await listAudit({})).length, 3);
});
