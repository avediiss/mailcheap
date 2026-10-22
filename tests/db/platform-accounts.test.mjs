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
	a = await makeTenant(db.models, { name: "Acme", slug: "acme", withEditor: true });
	root = await db.models.User.create({ email: "root@platform.test", name: "Root", passwordHash: "x", isPlatformAdmin: true, lastLoginAt: new Date() });
});

const id = (doc) => String(doc._id);

test("the account list shows every login with the workspaces they belong to, and searches by email or name", async () => {
	const { listAccounts } = await import("@/lib/platform-accounts");
	const { accounts, total } = await listAccounts();
	assert.equal(total, 3);
	assert.equal(accounts[0].email, "root@platform.test", "the most recently seen first");
	const owner = accounts.find(({ email }) => email === a.owner.email);
	assert.deepEqual(owner.memberships, [{ workspaceId: id(a.workspace), name: "Acme", role: "owner" }]);
	assert.deepEqual(accounts.find(({ email }) => email === "root@platform.test").memberships, []);
	assert.equal(accounts.some((account) => "passwordHash" in account), false, "never the hash");

	assert.deepEqual((await listAccounts({ query: "EDITOR@" })).accounts.map(({ email }) => email), [a.editor.email]);
	assert.deepEqual((await listAccounts({ query: "root" })).accounts.map(({ email }) => email), ["root@platform.test"]);
	assert.equal((await listAccounts({ query: ".*" })).total, 0, "a search is text, never a pattern");
});

test("only administrators can use the account actions, and nothing changes for anyone else", async () => {
	const actions = await import("@/app/(app)/platform/actions");
	for (const user of [a.owner, a.editor]) {
		await loginAs(user);
		for (const run of [() => actions.setAccountDisabledAction(id(root), true), () => actions.signOutAccountAction(id(root)), () => actions.sendAccountResetAction(id(root))]) {
			assert.equal((await catching(run)).redirectTo, "/");
		}
	}
	const after = await db.models.User.findById(root._id);
	assert.equal(after.disabledAt, undefined);
	assert.equal(after.sessionVersion, 0);
	assert.equal(await db.models.AuditLog.countDocuments(), 0);
});

test("disabling an account signs the person out at once, enabling brings them back, both are recorded", async () => {
	const { setAccountDisabledAction } = await import("@/app/(app)/platform/actions");
	const { getSession } = await import("@/lib/auth");

	const { jar } = await loginAs(a.editor);
	const cookies = new Map(jar);
	assert.equal((await getSession())?.email, a.editor.email);

	await loginAs(root);
	assert.deepEqual(await setAccountDisabledAction(id(a.editor), true), { ok: true });
	assert.ok((await db.models.User.findById(a.editor._id)).disabledAt);
	globalThis.__testRequest.cookies = cookies;
	assert.equal(await getSession(), null, "their old session no longer works");

	await loginAs(root);
	assert.deepEqual(await setAccountDisabledAction(id(a.editor), false), { ok: true });
	assert.equal((await db.models.User.findById(a.editor._id)).disabledAt, undefined);
	assert.deepEqual((await db.models.AuditLog.find().sort({ createdAt: 1 })).map(({ action }) => action), ["account.disabled", "account.enabled"]);

	assert.equal((await setAccountDisabledAction("nope", true)).error, "Account not found");
	assert.equal((await setAccountDisabledAction("64b000000000000000000000", true)).error, "Account not found");
});

test("you can't disable yourself, or the only administrator who can still log in", async () => {
	const { setAccountDisabledAction } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	assert.match((await setAccountDisabledAction(id(root), true)).error, /own account/);

	const second = await db.models.User.create({ email: "second@platform.test", passwordHash: "x", isPlatformAdmin: true });
	await db.models.User.updateOne({ _id: root._id }, { $set: { disabledAt: new Date() } });
	await loginAs(second);
	// Root is disabled already, so second is the only one who can log in: disabling root changes nothing, but
	// disabling second (by itself or any other) is refused.
	assert.match((await setAccountDisabledAction(id(second), true)).error, /own account/);
	await db.models.User.updateOne({ _id: root._id }, { $unset: { disabledAt: 1 } });
	await db.models.User.updateOne({ _id: second._id }, { $set: { disabledAt: new Date() } });
	await loginAs(a.owner);
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { isPlatformAdmin: true } });
	await db.models.User.updateOne({ _id: second._id }, { $unset: { disabledAt: 1 } });
	// Two enabled administrators besides the owner: disabling one of them is fine.
	assert.deepEqual(await setAccountDisabledAction(id(second), true), { ok: true });
	// Now root and the owner remain; disabling root leaves the owner, so it works, and then the owner is the last.
	assert.deepEqual(await setAccountDisabledAction(id(root), true), { ok: true });
	assert.equal(await db.models.User.countDocuments({ isPlatformAdmin: true, disabledAt: null }), 1);
});

test("signing out everywhere ends their sessions without disabling them", async () => {
	const { signOutAccountAction } = await import("@/app/(app)/platform/actions");
	const { getSession } = await import("@/lib/auth");
	const { jar } = await loginAs(a.owner);
	const cookies = new Map(jar);
	await loginAs(root);
	assert.deepEqual(await signOutAccountAction(id(a.owner)), { ok: true });
	assert.equal((await db.models.User.findById(a.owner._id)).sessionVersion, 1);
	assert.equal((await db.models.User.findById(a.owner._id)).disabledAt, undefined);
	globalThis.__testRequest.cookies = cookies;
	assert.equal(await getSession(), null);
	assert.equal(await db.models.AuditLog.countDocuments({ action: "account.signed-out" }), 1);
});

test("a password reset email goes to that account's own address, not to a disabled one", async () => {
	const { sendAccountResetAction, setAccountDisabledAction } = await import("@/app/(app)/platform/actions");
	await loginAs(root);
	assert.deepEqual(await sendAccountResetAction(id(a.editor)), { ok: true });
	const email = globalThis.__sentEmails.find(({ to }) => to === a.editor.email);
	assert.ok(email, "sent to the account");
	assert.match(email.text, /reset-password\?token=/);
	assert.equal(globalThis.__sentEmails.length, 1);
	assert.equal(await db.models.AuditLog.countDocuments({ action: "account.reset-sent" }), 1);

	await setAccountDisabledAction(id(a.editor), true);
	globalThis.__sentEmails.length = 0;
	assert.equal((await sendAccountResetAction(id(a.editor))).error, "Enable this account first");
	assert.equal(globalThis.__sentEmails.length, 0);
	logout();
});
