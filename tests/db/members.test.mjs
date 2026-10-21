import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, makeTenant, logout, startDb } from "./helpers.mjs";

let db;
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
});

const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};
const tokenOf = (link) => link.split("/invite/")[1];
async function invite(email, role = "editor") {
	const actions = await import("@/app/(app)/members/actions");
	return actions.inviteToWorkspace(null, form({ email, role }));
}

test("an owner invites someone: the invitation is stored hashed, the email carries the link, and it can't be reused", async () => {
	await loginAs(a.owner);
	const result = await invite("New.Person@Example.com", "editor");
	assert.equal(result.ok, true);
	assert.equal(result.emailed, true);

	const stored = await db.models.Invitation.findOne({ email: "new.person@example.com" });
	assert.equal(stored.status, "pending");
	assert.equal(String(stored.workspaceId), id(a.workspace));
	assert.notEqual(stored.tokenHash, tokenOf(result.link), "only the hash is stored");
	assert.ok(stored.expiresAt.getTime() - Date.now() > 6.9 * 86400_000);

	const email = globalThis.__sentEmails.find(({ to }) => to === "new.person@example.com");
	assert.ok(email.text.includes(result.link));
	assert.match(email.subject, /Acme/);
	assert.ok(email.from.includes("alerts@platform.test"));
});

test("inviting rejects bad addresses, existing members and unknown roles, and refreshes an open invitation", async () => {
	await loginAs(a.owner);
	assert.match((await invite("not-an-email")).error, /valid email/);
	assert.match((await invite(a.editor.email)).error, /already in this workspace/);
	assert.match((await invite("x@example.com", "superadmin")).error, /Pick a role/);

	const first = await invite("again@example.com", "editor");
	const second = await invite("again@example.com", "owner");
	assert.equal(await db.models.Invitation.countDocuments({ email: "again@example.com", status: "pending" }), 1);
	assert.equal((await db.models.Invitation.findOne({ email: "again@example.com" })).role, "owner");
	const { findInvitationByToken } = await import("@/lib/members");
	assert.equal((await findInvitationByToken(tokenOf(first.link))).state, "invalid", "the first link stopped working");
	assert.equal((await findInvitationByToken(tokenOf(second.link))).state, "usable");
});

test("editors, and people in other workspaces, can't manage members", async () => {
	const actions = await import("@/app/(app)/members/actions");
	await loginAs(a.owner);
	const pending = await invite("pending@example.com");

	await loginAs(a.editor);
	for (const result of [
		await invite("sneaky@example.com"),
		await actions.resendInvitation(pending.invitationId),
		await actions.getInvitationLink(pending.invitationId),
		await actions.revokeWorkspaceInvitation(pending.invitationId),
		await actions.setMemberRole(id(a.owner), "editor"),
		await actions.removeWorkspaceMember(id(a.owner)),
	]) {
		assert.equal(result.error, "Only a workspace owner can manage members");
	}
	assert.equal(await db.models.Invitation.countDocuments({ status: "pending" }), 1);

	// An owner of another workspace gets "not found" for ids that aren't theirs.
	await loginAs(b.owner);
	assert.equal((await actions.resendInvitation(pending.invitationId)).error, "Invitation not found");
	assert.equal((await actions.getInvitationLink(pending.invitationId)).error, "Invitation not found");
	assert.equal((await actions.revokeWorkspaceInvitation(pending.invitationId)).error, "Invitation not found");
	assert.equal((await actions.setMemberRole(id(a.editor), "owner")).error, "This person is not in the workspace");
	assert.equal((await actions.removeWorkspaceMember(id(a.editor))).error, "This person is not in the workspace");
	assert.equal((await db.models.Invitation.findOne({ email: "pending@example.com" })).status, "pending");
	assert.equal((await db.models.Membership.findOne({ userId: a.editor._id })).role, "editor");
});

test("a suspended workspace can't invite anyone", async () => {
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "suspended" } });
	await loginAs(a.owner);
	assert.equal((await invite("late@example.com")).error, "This workspace is suspended");
});

test("a new person accepts: account, membership and login are created, and the link works once", async () => {
	await loginAs(a.owner);
	const { link } = await invite("fresh@example.com", "editor");
	const token = tokenOf(link);
	logout();

	const { acceptInvitation } = await import("@/app/invite/[token]/actions");
	const { getSession } = await import("@/lib/auth");
	const submit = (overrides = {}) => acceptInvitation(null, form({ token, name: "Fresh Person", password: "a good long password", confirm: "a good long password", ...overrides }));

	assert.match((await submit({ confirm: "different" })).error, /don't match/);
	assert.match((await submit({ password: "short", confirm: "short" })).error, /at least/);
	assert.equal(await db.models.User.countDocuments({ email: "fresh@example.com" }), 0, "nothing created by the failed tries");

	const accepted = await catching(() => submit());
	assert.equal(accepted.redirectTo, "/");
	const user = await db.models.User.findOne({ email: "fresh@example.com" });
	assert.equal(user.name, "Fresh Person");
	assert.equal(user.isPlatformAdmin, false);
	assert.ok(await db.models.Membership.exists({ userId: user._id, workspaceId: a.workspace._id, role: "editor" }));
	assert.equal((await getSession()).email, "fresh@example.com", "logged in");

	logout();
	assert.match((await submit()).error, /expired or was already used/, "single use");
});

test("an expired or revoked invitation can't be accepted", async () => {
	const { acceptInvitationNewUser, findInvitationByToken } = await import("@/lib/members");
	const actions = await import("@/app/(app)/members/actions");
	await loginAs(a.owner);
	const expired = await invite("old@example.com");
	await db.models.Invitation.updateOne({ email: "old@example.com" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
	assert.equal((await findInvitationByToken(tokenOf(expired.link))).state, "expired");
	assert.match((await acceptInvitationNewUser({ token: tokenOf(expired.link), password: "a good long password" })).error, /expired/);

	const revoked = await invite("revoked@example.com");
	await actions.revokeWorkspaceInvitation(revoked.invitationId);
	assert.equal((await findInvitationByToken(tokenOf(revoked.link))).state, "revoked");
	assert.match((await acceptInvitationNewUser({ token: tokenOf(revoked.link), password: "a good long password" })).error, /expired or was already used/);
	assert.equal(await db.models.User.countDocuments({ email: { $in: ["old@example.com", "revoked@example.com"] } }), 0);
	assert.equal((await findInvitationByToken("x".repeat(43))).state, "invalid");
	assert.equal((await findInvitationByToken(undefined)).state, "invalid");
});

test("someone who already has an account joins only while logged in as the invited address", async () => {
	await loginAs(a.owner);
	const { link } = await invite(b.owner.email, "editor");
	const token = tokenOf(link);
	const { joinWorkspace } = await import("@/app/invite/[token]/actions");
	const { findInvitationByToken, acceptInvitationNewUser } = await import("@/lib/members");

	assert.equal((await findInvitationByToken(token)).hasAccount, true);
	assert.match((await acceptInvitationNewUser({ token, password: "a good long password" })).error, /already has an account/);

	// Logged in as someone else: refused, and the invitation stays usable.
	await loginAs(a.editor);
	assert.match((await joinWorkspace(null, form({ token }))).error, /is for .*You're signed in as/);
	assert.equal((await findInvitationByToken(token)).state, "usable");
	logout();
	assert.equal((await joinWorkspace(null, form({ token }))).error, "Log in first");

	await loginAs(b.owner);
	assert.equal((await catching(() => joinWorkspace(null, form({ token })))).redirectTo, "/");
	assert.ok(await db.models.Membership.exists({ userId: b.owner._id, workspaceId: a.workspace._id, role: "editor" }));
	const { getWorkspaceContext } = await import("@/lib/workspace");
	assert.deepEqual((await getWorkspaceContext()).workspaces.map(({ slug }) => slug), ["acme", "birch"]);
});

test("a workspace always keeps an owner", async () => {
	const actions = await import("@/app/(app)/members/actions");
	await loginAs(a.owner);
	assert.match((await actions.removeWorkspaceMember(id(a.owner))).error, /at least one owner/);
	assert.match((await actions.setMemberRole(id(a.owner), "editor")).error, /at least one owner/);
	assert.ok(await db.models.Membership.exists({ userId: a.owner._id, role: "owner" }));

	assert.deepEqual(await actions.setMemberRole(id(a.editor), "owner"), { ok: true });
	assert.deepEqual(await actions.setMemberRole(id(a.owner), "editor"), { ok: true }, "fine once there is another owner");
	assert.equal((await db.models.Membership.findOne({ userId: a.owner._id })).role, "editor");

	// The other owner, now alone, is protected in turn.
	await loginAs(a.editor);
	assert.match((await actions.removeWorkspaceMember(id(a.editor))).error, /at least one owner/);
	assert.deepEqual(await actions.removeWorkspaceMember(id(a.owner)), { ok: true });
	assert.equal(await db.models.Membership.countDocuments({ workspaceId: a.workspace._id }), 1);
});

test("a copied invitation link replaces the old one", async () => {
	const actions = await import("@/app/(app)/members/actions");
	const { findInvitationByToken } = await import("@/lib/members");
	await loginAs(a.owner);
	const sentBefore = globalThis.__sentEmails.length;
	const first = await invite("copy@example.com");
	const copied = await actions.getInvitationLink(first.invitationId);
	assert.equal((await findInvitationByToken(tokenOf(first.link))).state, "invalid");
	assert.equal((await findInvitationByToken(tokenOf(copied.link))).state, "usable");
	assert.equal(globalThis.__sentEmails.length, sentBefore + 1, "copying a link sends nothing");

	const resent = await actions.resendInvitation(first.invitationId);
	assert.equal(resent.emailed, true);
	assert.equal((await findInvitationByToken(tokenOf(copied.link))).state, "invalid");
	assert.equal((await findInvitationByToken(tokenOf(resent.link))).state, "usable");
});

test("when the invitation email can't be sent, the owner still gets the link and the reason", async () => {
	const actions = await import("@/app/(app)/members/actions");
	delete process.env.ALERT_FROM;
	try {
		await loginAs(a.owner);
		const result = await invite("noemail@example.com");
		assert.equal(result.ok, true);
		assert.equal(result.emailed, false);
		assert.match(result.reason, /PLATFORM_FROM/);
		assert.match(result.link, /\/invite\//);
		assert.equal((await actions.resendInvitation(result.invitationId)).emailed, false);
	} finally {
		process.env.ALERT_FROM = "Namag <alerts@platform.test>";
	}
});
