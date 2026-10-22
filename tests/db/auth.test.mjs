import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, logout, makeTenant, startDb } from "./helpers.mjs";

let db;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(() => db.reset());

test("the owner's first login with the environment's email and password creates their account, once", async () => {
	const { authenticate } = await import("@/lib/auth");
	assert.equal(await authenticate("owner@platform.test", "wrong password here"), null);
	assert.equal(await db.models.User.countDocuments(), 0, "a wrong password creates nothing");

	const user = await authenticate(" Owner@Platform.test ", process.env.ADMIN_PASSWORD);
	assert.equal(user.email, "owner@platform.test");
	assert.equal(user.isPlatformAdmin, true);
	assert.notEqual(user.passwordHash, process.env.ADMIN_PASSWORD, "stored hashed");

	const again = await authenticate("owner@platform.test", process.env.ADMIN_PASSWORD);
	assert.equal(String(again._id), String(user._id));
	assert.equal(await db.models.User.countDocuments(), 1);
});

test("once the account exists, the database decides: the old environment password no longer works after a change", async () => {
	const { authenticate } = await import("@/lib/auth");
	const { hashPassword } = await import("@/lib/passwords");
	const user = await authenticate("owner@platform.test", process.env.ADMIN_PASSWORD);
	await db.models.User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword("a brand new password") } });
	assert.equal(await authenticate("owner@platform.test", process.env.ADMIN_PASSWORD), null);
	assert.ok(await authenticate("owner@platform.test", "a brand new password"));
});

test("a disabled account can't log in, even with the right password", async () => {
	const { authenticate } = await import("@/lib/auth");
	const a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	assert.ok(await authenticate(a.owner.email, "a long enough password"));
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { disabledAt: new Date() } });
	assert.equal(await authenticate(a.owner.email, "a long enough password"), null);
	assert.equal(await authenticate("nobody@nowhere.test", "a long enough password"), null);
});

test("a session stops working when the person is signed out everywhere, disabled or deleted", async () => {
	const { getSession } = await import("@/lib/auth");
	const a = await makeTenant(db.models, { name: "Acme", slug: "acme" });

	await loginAs(a.owner);
	assert.equal((await getSession()).email, a.owner.email);

	await db.models.User.updateOne({ _id: a.owner._id }, { $inc: { sessionVersion: 1 } });
	assert.equal(await getSession(), null, "a password change signs the cookie out");

	await loginAs(await db.models.User.findById(a.owner._id));
	assert.ok(await getSession());
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { disabledAt: new Date() } });
	assert.equal(await getSession(), null);

	await db.models.User.updateOne({ _id: a.owner._id }, { $unset: { disabledAt: 1 } });
	await loginAs(await db.models.User.findById(a.owner._id));
	await db.models.User.deleteOne({ _id: a.owner._id });
	assert.equal(await getSession(), null);
	logout();
	assert.equal(await getSession(), null);
});

test("a reset link works once, expires, and signs the person out everywhere", async () => {
	const { resetPassword } = await import("@/lib/password-reset");
	const { createResetToken, getResetExpiry } = await import("@/lib/session-rules");
	const { authenticate } = await import("@/lib/auth");
	const a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	const { token, tokenHash } = createResetToken();
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { passwordReset: { tokenHash, expiresAt: getResetExpiry() } } });

	assert.match((await resetPassword(token, "short")).error, /at least/);
	assert.match((await resetPassword("x".repeat(43), "a perfectly good password")).error, /expired|valid/);
	assert.deepEqual(await resetPassword(token, "a perfectly good password"), { ok: true });
	assert.match((await resetPassword(token, "another good password!")).error, /expired|already used/, "single use");

	const after = await db.models.User.findById(a.owner._id);
	assert.equal(after.sessionVersion, 1);
	assert.equal(after.passwordReset?.tokenHash, undefined, "the link is gone once used");
	assert.ok(await authenticate(a.owner.email, "a perfectly good password"));
	assert.equal(await authenticate(a.owner.email, "a long enough password"), null);

	const expired = createResetToken();
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { passwordReset: { tokenHash: expired.tokenHash, expiresAt: new Date(Date.now() - 1000) } } });
	assert.match((await resetPassword(expired.token, "yet another good password")).error, /expired/);
});

test("the workspace a person works in: only the ones they belong to, even for the platform owner, and the cookie can't reach others", async () => {
	const { getWorkspaceContext, requireWorkspace, WORKSPACE_COOKIE } = await import("@/lib/workspace");
	const { switchWorkspace } = await import("@/app/(app)/workspaces/actions");
	const a = await makeTenant(db.models, { name: "Acme", slug: "acme", withEditor: true });
	const b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	const root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });

	const { jar } = await loginAs(a.owner);
	let context = await getWorkspaceContext();
	assert.deepEqual(context.workspaces.map(({ slug }) => slug), ["acme"]);
	assert.equal(String(context.workspaceId), String(a.workspace._id));
	assert.equal(context.role, "owner");

	// Pointing the cookie at someone else's workspace changes nothing.
	jar.set(WORKSPACE_COOKIE, String(b.workspace._id));
	context = await getWorkspaceContext();
	assert.equal(String(context.workspaceId), String(a.workspace._id));
	assert.equal((await switchWorkspace(String(b.workspace._id))).error, "Workspace not found");

	await loginAs(a.editor);
	assert.equal((await getWorkspaceContext()).role, "editor");

	// The platform owner controls workspaces from the console but is not let inside any of them.
	await loginAs(root);
	context = await getWorkspaceContext();
	assert.equal(context.session.isPlatformAdmin, true);
	assert.deepEqual(context.workspaces, []);
	assert.equal(context.workspace, null);
	assert.equal((await switchWorkspace(String(b.workspace._id))).error, "Workspace not found");
	assert.equal((await catching(() => requireWorkspace())).redirectTo, "/platform", "their home is the console");

	// Invited into one, they see that one and no other.
	await db.models.Membership.create({ userId: root._id, workspaceId: b.workspace._id, role: "editor" });
	context = await getWorkspaceContext();
	assert.deepEqual(context.workspaces.map(({ slug }) => slug), ["birch"]);
	assert.equal(context.role, "editor", "being the platform owner adds no rights inside it");

	const lonely = await db.models.User.create({ email: "lonely@x.test", passwordHash: "x" });
	await loginAs(lonely);
	assert.equal((await getWorkspaceContext()).workspace, null);
	assert.equal((await catching(() => requireWorkspace())).redirectTo, "/no-workspace");
	logout();
	assert.equal(await getWorkspaceContext(), null);
	assert.equal((await catching(() => requireWorkspace())).redirectTo, "/login");
});
