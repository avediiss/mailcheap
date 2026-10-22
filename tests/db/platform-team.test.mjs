import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, logout, makeTenant, startDb } from "./helpers.mjs";

let db;
let root;
let a;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	root = await db.models.User.create({ email: "root@platform.test", name: "Root", passwordHash: "x", isPlatformAdmin: true });
});

const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};
const tokenOf = (link) => link.split("/invite/")[1];
const PASSWORD = "a good long password";

test("inviting an administrator: an invitation with no workspace, an email that says so, and a record", async () => {
	const { invitePlatformTeamMember } = await import("@/app/(app)/platform/actions");
	const { findInvitationByToken } = await import("@/lib/members");
	await loginAs(root);

	assert.match((await invitePlatformTeamMember(null, form({ email: "nope" }))).error, /valid email/);
	assert.match((await invitePlatformTeamMember(null, form({ email: "root@platform.test" }))).error, /already a platform administrator/);

	const result = await invitePlatformTeamMember(null, form({ email: "Second@Platform.test" }));
	assert.equal(result.ok, true);
	const stored = await db.models.Invitation.findOne({ email: "second@platform.test" });
	assert.equal(stored.platformAdmin, true);
	assert.equal(stored.workspaceId, undefined);
	assert.notEqual(stored.tokenHash, tokenOf(result.link), "only the hash is stored");

	const email = globalThis.__sentEmails.find(({ to }) => to === "second@platform.test");
	assert.ok(email.text.includes(result.link));
	assert.match(email.subject, /run Namag/);
	assert.equal(await db.models.AuditLog.countDocuments({ action: "platform.admin.invited" }), 1);

	const found = await findInvitationByToken(tokenOf(result.link));
	assert.equal(found.state, "usable");
	assert.equal(found.isPlatformInvite, true);
	assert.equal(found.workspaceName, "");

	// Inviting again refreshes the open invitation instead of piling up a second one.
	await invitePlatformTeamMember(null, form({ email: "second@platform.test" }));
	assert.equal(await db.models.Invitation.countDocuments({ platformAdmin: true, status: "pending" }), 1);
});

test("a new person accepts: an administrator-only account, in no workspace, who lands in the console", async () => {
	const { invitePlatformTeamMember } = await import("@/app/(app)/platform/actions");
	const { acceptInvitation } = await import("@/app/invite/[token]/actions");
	const { getWorkspaceContext, requireWorkspace } = await import("@/lib/workspace");
	await loginAs(root);
	const { link } = await invitePlatformTeamMember(null, form({ email: "second@platform.test" }));
	logout();

	const token = tokenOf(link);
	await catching(() => acceptInvitation(null, form({ token, name: "Second", password: PASSWORD, confirm: PASSWORD })));
	const user = await db.models.User.findOne({ email: "second@platform.test" });
	assert.equal(user.isPlatformAdmin, true);
	assert.equal(await db.models.Membership.countDocuments({ userId: user._id }), 0, "no workspace");

	const context = await getWorkspaceContext();
	assert.equal(context.session.isPlatformAdmin, true);
	assert.equal(context.workspace, null);
	assert.equal((await catching(() => requireWorkspace())).redirectTo, "/platform");

	logout();
	assert.match((await acceptInvitation(null, form({ token, name: "Again", password: PASSWORD, confirm: PASSWORD }))).error, /expired or was already used/, "single use");
});

test("someone with an account accepts while logged in as the invited address, and keeps their workspace", async () => {
	const { invitePlatformTeamMember } = await import("@/app/(app)/platform/actions");
	const { joinWorkspace } = await import("@/app/invite/[token]/actions");
	await loginAs(root);
	const { link } = await invitePlatformTeamMember(null, form({ email: a.owner.email }));
	const token = tokenOf(link);

	// Someone else, or nobody: refused, and the link stays usable.
	await loginAs(root);
	assert.match((await joinWorkspace(null, form({ token }))).error, /is for .*You're signed in as/);
	logout();
	assert.equal((await joinWorkspace(null, form({ token }))).error, "Log in first");

	await loginAs(a.owner);
	assert.equal((await catching(() => joinWorkspace(null, form({ token })))).redirectTo, "/");
	assert.equal((await db.models.User.findById(a.owner._id)).isPlatformAdmin, true);
	assert.equal(await db.models.Membership.countDocuments({ userId: a.owner._id }), 1, "still only their own workspace");
	const { getWorkspaceContext } = await import("@/lib/workspace");
	assert.deepEqual((await getWorkspaceContext()).workspaces.map(({ slug }) => slug), ["acme"]);
});

test("an expired or revoked administrator invitation can't be accepted", async () => {
	const { invitePlatformTeamMember, revokePlatformTeamInvitation } = await import("@/app/(app)/platform/actions");
	const { acceptInvitationNewUser } = await import("@/lib/members");
	await loginAs(root);
	const expired = await invitePlatformTeamMember(null, form({ email: "late@platform.test" }));
	await db.models.Invitation.updateOne({ email: "late@platform.test" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
	assert.match((await acceptInvitationNewUser({ token: tokenOf(expired.link), password: PASSWORD })).error, /expired/);

	const revoked = await invitePlatformTeamMember(null, form({ email: "nevermind@platform.test" }));
	const invitation = await db.models.Invitation.findOne({ email: "nevermind@platform.test" });
	assert.deepEqual(await revokePlatformTeamInvitation(id(invitation)), { ok: true });
	assert.match((await acceptInvitationNewUser({ token: tokenOf(revoked.link), password: PASSWORD })).error, /expired or was already used/);
	assert.equal((await revokePlatformTeamInvitation(id(invitation))).error, "Invitation not found");
	assert.equal(await db.models.User.countDocuments({ isPlatformAdmin: true }), 1);
});

test("removing an administrator: never the last one, yourself only when someone else remains, and it is recorded", async () => {
	const { removePlatformTeamMember } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	assert.match((await removePlatformTeamMember(id(root))).error, /at least one administrator/);
	assert.equal((await db.models.User.findById(root._id)).isPlatformAdmin, true);
	assert.match((await removePlatformTeamMember(id(a.owner))).error, /not a platform administrator/);
	assert.match((await removePlatformTeamMember("nope")).error, /not a platform administrator/);

	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { isPlatformAdmin: true } });
	assert.deepEqual(await removePlatformTeamMember(id(root)), { ok: true });
	assert.equal((await db.models.User.findById(root._id)).isPlatformAdmin, false, "removed themself");
	assert.equal(await db.models.AuditLog.countDocuments({ action: "platform.admin.removed" }), 1);

	// The one who is left can't remove themself, and a disabled administrator doesn't count as one.
	await loginAs(a.owner);
	assert.match((await removePlatformTeamMember(id(a.owner))).error, /at least one administrator/);
	await db.models.User.updateOne({ _id: root._id }, { $set: { isPlatformAdmin: true, disabledAt: new Date() } });
	assert.match((await removePlatformTeamMember(id(a.owner))).error, /at least one administrator/);
});

test("platform alerts go to every administrator, and the environment's address is only the fallback", async () => {
	const { listPlatformAdminEmails } = await import("@/lib/platform-team");
	const { sendAlert } = await import("@/lib/alerts");
	await db.models.User.create({ email: "second@platform.test", passwordHash: "x", isPlatformAdmin: true });
	await db.models.User.create({ email: "gone@platform.test", passwordHash: "x", isPlatformAdmin: true, disabledAt: new Date() });
	assert.deepEqual((await listPlatformAdminEmails()).sort(), ["root@platform.test", "second@platform.test"]);

	await sendAlert({ key: "team-test", title: "Something to know", detail: "x", audience: "platform" });
	const recipients = globalThis.__sentEmails.filter(({ subject }) => /Something to know/.test(subject)).map(({ to }) => to).sort();
	assert.deepEqual(recipients, ["root@platform.test", "second@platform.test"]);

	await db.models.User.updateMany({}, { $set: { isPlatformAdmin: false } });
	assert.deepEqual(await listPlatformAdminEmails(), [process.env.ADMIN_EMAIL.toLowerCase()]);
});

test("assigning a domain to a workspace from the console: checked, recorded, and platform only", async () => {
	const { assignDomain } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	assert.equal((await assignDomain(null, form({ id: "nope", domain: "acme.io" }))).error, "Workspace not found");
	assert.equal((await assignDomain(null, form({ id: "64b000000000000000000000", domain: "acme.io" }))).error, "Workspace not found");
	assert.deepEqual(await assignDomain(null, form({ id: id(a.workspace), domain: "acme.io" })), { ok: true, domain: "acme.io" });
	assert.ok(await db.models.Domain.exists({ workspaceId: a.workspace._id, domain: "acme.io" }));
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.domain" }), 1);

	await loginAs(a.owner);
	assert.equal((await catching(() => assignDomain(null, form({ id: id(a.workspace), domain: "mine.io" })))).redirectTo, "/");
	assert.equal(await db.models.Domain.countDocuments({ domain: "mine.io" }), 0);
});
