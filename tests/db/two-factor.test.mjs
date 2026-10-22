import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, logout, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	process.env.REQUIRE_ADMIN_2FA = "false";
	a = await makeTenant(db.models, { name: "Acme", slug: "acme", withEditor: true });
});

const PASSWORD = "a long enough password";
const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};
let ipCounter = 0;
// Every test comes from its own address, so the per-address limits of one test never reach another.
const fromNewAddress = () => globalThis.__testRequest.headers.set("x-forwarded-for", `10.0.0.${++ipCounter}`);

async function totp() {
	return import("@/lib/totp");
}
// A code for the step after now: always inside the accepted window, and newer than any step already used.
async function nextCode(secret, offset = 1) {
	const { getTotpStep, totpCodeAt } = await totp();
	return totpCodeAt(secret, getTotpStep() + offset);
}

// Turns two-factor on for the logged-in person and returns what they'd keep: the secret and the recovery codes.
async function enable(user) {
	const { startTwoFactorSetup, finishTwoFactorSetup } = await import("@/app/(app)/account/actions");
	await loginAs(user);
	const started = await startTwoFactorSetup();
	// The step before now: later tests then still have newer codes to use.
	const finished = await finishTwoFactorSetup(null, form({ code: await nextCode(started.secret, -1) }));
	assert.equal(finished.ok, true, finished.error);
	logout();
	return { secret: started.secret, recoveryCodes: finished.recoveryCodes };
}

function assertNoTwoFactor(user) {
	assert.equal(user.twoFactor.enabledAt, undefined);
	assert.equal(user.twoFactor.secret, undefined);
	assert.equal(user.twoFactor.recoveryCodes.length, 0);
}

async function passwordLogin(user, next = "/") {
	const { login } = await import("@/app/login/actions");
	return catching(() => login(null, form({ email: user.email, password: PASSWORD, next })));
}

test("setup: a secret is kept encrypted until a code from the app proves it, then recovery codes are shown once", async () => {
	const { startTwoFactorSetup, finishTwoFactorSetup } = await import("@/app/(app)/account/actions");
	const { decryptSecret, hashRecoveryCode } = await import("@/lib/two-factor-crypto");
	const { normalizeRecoveryCode } = await totp();
	await loginAs(a.owner);
	fromNewAddress();

	const started = await startTwoFactorSetup();
	assert.match(started.secret, /^[A-Z2-7]{32}$/);
	assert.match(started.qr, /^<svg /);
	let stored = await db.models.User.findById(a.owner._id);
	assert.notEqual(stored.twoFactor.pendingSecret, started.secret, "not kept in the clear");
	assert.equal(decryptSecret(stored.twoFactor.pendingSecret), started.secret);
	assert.equal(stored.twoFactor.enabledAt, undefined, "not on yet");

	assert.match((await finishTwoFactorSetup(null, form({ code: "000000" }))).error, /isn't right/);
	assert.equal((await db.models.User.findById(a.owner._id)).twoFactor.enabledAt, undefined);

	const finished = await finishTwoFactorSetup(null, form({ code: await nextCode(started.secret) }));
	assert.equal(finished.ok, true);
	assert.equal(finished.recoveryCodes.length, 10);
	stored = await db.models.User.findById(a.owner._id);
	assert.ok(stored.twoFactor.enabledAt);
	assert.equal(stored.twoFactor.pendingSecret, undefined);
	assert.equal(stored.twoFactor.recoveryCodes.length, 10);
	for (const code of finished.recoveryCodes) {
		assert.ok(stored.twoFactor.recoveryCodes.includes(hashRecoveryCode(normalizeRecoveryCode(code))));
		assert.equal(stored.twoFactor.recoveryCodes.includes(code), false, "only hashes are kept");
	}
	assert.equal((await startTwoFactorSetup()).error, "Two-factor login is already on");
});

test("a setup left for too long starts over, and a changed or foreign secret never decrypts", async () => {
	const { startTwoFactorSetup, finishTwoFactorSetup } = await import("@/app/(app)/account/actions");
	const { encryptSecret, decryptSecret } = await import("@/lib/two-factor-crypto");
	await loginAs(a.owner);
	fromNewAddress();
	const started = await startTwoFactorSetup();
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { "twoFactor.pendingAt": new Date(Date.now() - 16 * 60_000) } });
	const late = await finishTwoFactorSetup(null, form({ code: await nextCode(started.secret) }));
	assert.match(late.error, /expired/);
	assert.equal(late.expired, true);

	const stored = encryptSecret("SECRETVALUE");
	assert.equal(decryptSecret(stored), "SECRETVALUE");
	assert.equal(decryptSecret(`${stored.slice(0, -2)}AA`), null, "a changed value is refused");
	assert.equal(decryptSecret("garbage"), null);
	assert.notEqual(encryptSecret("SECRETVALUE"), stored, "a fresh IV each time");
	const original = process.env.SESSION_SECRET;
	process.env.SESSION_SECRET = "x".repeat(40);
	try {
		assert.equal(decryptSecret(stored), null, "another server secret can't read it");
	} finally {
		process.env.SESSION_SECRET = original;
	}
});

test("logging in with a second factor: the password alone starts no session, the code does", async () => {
	const { verifyLogin } = await import("@/app/login/actions");
	const { getSession } = await import("@/lib/auth");
	const { CHALLENGE_COOKIE, SESSION_COOKIE } = await import("@/lib/session-token");
	const { secret } = await enable(a.owner);

	fromNewAddress();
	const first = await passwordLogin(a.owner, "/contacts");
	assert.equal(first.redirectTo, "/login/verify");
	assert.ok(globalThis.__testRequest.cookies.get(CHALLENGE_COOKIE), "a challenge cookie");
	assert.equal(globalThis.__testRequest.cookies.has(SESSION_COOKIE), false, "no session yet");
	assert.equal(await getSession(), null);

	assert.match((await verifyLogin(null, form({ code: "123456" }))).error, /isn't right/);
	assert.equal(await getSession(), null, "a wrong code starts nothing");

	const goodCode = await nextCode(secret);
	const done = await catching(() => verifyLogin(null, form({ code: goodCode })));
	assert.equal(done.redirectTo, "/contacts", "back to where they were going");
	assert.equal((await getSession()).email, a.owner.email);
	assert.equal(globalThis.__testRequest.cookies.has(CHALLENGE_COOKIE), false, "the challenge is used up");
	assert.ok((await db.models.User.findById(a.owner._id)).lastLoginAt);
});

test("an app code works once: the same code, or an older one, is refused on the next login", async () => {
	const { verifyLogin } = await import("@/app/login/actions");
	const { getSession } = await import("@/lib/auth");
	const { secret } = await enable(a.owner);
	const code = await nextCode(secret, 1);

	fromNewAddress();
	await passwordLogin(a.owner);
	assert.equal((await catching(() => verifyLogin(null, form({ code })))).redirectTo, "/");

	logout();
	fromNewAddress();
	await passwordLogin(a.owner);
	assert.match((await verifyLogin(null, form({ code }))).error, /isn't right/, "the same code, seen over a shoulder");
	assert.match((await verifyLogin(null, form({ code: await nextCode(secret, 0) }))).error, /isn't right/, "an older code");
	assert.equal(await getSession(), null);
});

test("a recovery code lets someone in once and is then gone", async () => {
	const { verifyLogin } = await import("@/app/login/actions");
	const { getSession } = await import("@/lib/auth");
	const { recoveryCodes } = await enable(a.owner);
	const [first, second] = recoveryCodes;

	fromNewAddress();
	await passwordLogin(a.owner);
	const result = await catching(() => verifyLogin(null, form({ code: first.toUpperCase().replaceAll("-", " ") })));
	assert.equal(result.redirectTo, "/", "capitals and spaces don't matter");
	assert.equal((await getSession()).email, a.owner.email);
	assert.equal((await db.models.User.findById(a.owner._id)).twoFactor.recoveryCodes.length, 9);

	logout();
	fromNewAddress();
	await passwordLogin(a.owner);
	assert.match((await verifyLogin(null, form({ code: first }))).error, /isn't right/, "used up");
	assert.equal((await catching(() => verifyLogin(null, form({ code: second })))).redirectTo, "/");
	assert.match((await verifyLogin(null, form({ code: "abcd-efgh-jkmn-pqrs" }))).error ?? "", /./, "an invented one is refused");
});

test("guessing is slowed down: a few wrong codes and even the right one is refused for a while", async () => {
	const { verifyLogin } = await import("@/app/login/actions");
	const { getSession } = await import("@/lib/auth");
	const { secret } = await enable(a.owner);
	fromNewAddress();
	await passwordLogin(a.owner);
	for (let attempt = 0; attempt < 5; attempt++) assert.match((await verifyLogin(null, form({ code: "000000" }))).error, /isn't right/);
	assert.match((await verifyLogin(null, form({ code: await nextCode(secret) }))).error, /Too many attempts/);
	assert.equal(await getSession(), null);
});

test("the challenge and the session are not interchangeable, and the challenge dies with the password or the account", async () => {
	const { verifyLogin } = await import("@/app/login/actions");
	const { getSession } = await import("@/lib/auth");
	const { CHALLENGE_COOKIE, SESSION_COOKIE, signChallengeToken, signSessionToken, verifyChallengeToken, verifySessionToken } = await import("@/lib/session-token");
	const { secret } = await enable(a.owner);

	const challengeToken = await signChallengeToken({ userId: a.owner._id, sessionVersion: 0, next: "/" });
	const sessionToken = await signSessionToken({ userId: a.owner._id, sessionVersion: 0 });
	assert.equal(await verifySessionToken(challengeToken), null, "a challenge is not a session");
	assert.equal(await verifyChallengeToken(sessionToken), null, "a session is not a challenge");

	// Someone with the challenge cookie but no session can't get one without the code.
	logout();
	fromNewAddress();
	globalThis.__testRequest.cookies.set(SESSION_COOKIE, challengeToken);
	assert.equal(await getSession(), null);

	// A session cookie in the challenge's place is refused.
	logout();
	fromNewAddress();
	globalThis.__testRequest.cookies.set(CHALLENGE_COOKIE, sessionToken);
	assert.equal((await verifyLogin(null, form({ code: await nextCode(secret) }))).expired, true);

	// The password changed between the two steps.
	logout();
	fromNewAddress();
	await passwordLogin(a.owner);
	await db.models.User.updateOne({ _id: a.owner._id }, { $inc: { sessionVersion: 1 } });
	assert.equal((await verifyLogin(null, form({ code: await nextCode(secret) }))).expired, true);
	assert.equal(await getSession(), null);

	// The account was switched off between the two steps.
	logout();
	fromNewAddress();
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { sessionVersion: 0 } });
	await passwordLogin(a.owner);
	await db.models.User.updateOne({ _id: a.owner._id }, { $set: { disabledAt: new Date() } });
	assert.equal((await verifyLogin(null, form({ code: await nextCode(secret) }))).expired, true);
	assert.equal(await getSession(), null);

	logout();
	assert.equal((await verifyLogin(null, form({ code: "123456" }))).expired, true, "no challenge at all");
});

test("people without a second factor log in exactly as before", async () => {
	const { getSession } = await import("@/lib/auth");
	fromNewAddress();
	const result = await passwordLogin(a.editor, "/contacts");
	assert.equal(result.redirectTo, "/contacts");
	assert.equal((await getSession()).email, a.editor.email);
});

test("administrators can't open the console without it, unless the emergency switch is set", async () => {
	const { requirePlatformAdmin } = await import("@/lib/auth");
	const root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
	process.env.REQUIRE_ADMIN_2FA = "true";

	await loginAs(root);
	assert.equal((await catching(() => requirePlatformAdmin())).redirectTo, "/account?setup=2fa");
	await loginAs(a.owner);
	assert.equal((await catching(() => requirePlatformAdmin())).redirectTo, "/", "everyone else just goes home");

	process.env.REQUIRE_ADMIN_2FA = "false";
	await loginAs(root);
	assert.equal((await requirePlatformAdmin()).email, "root@platform.test");

	delete process.env.REQUIRE_ADMIN_2FA;
	assert.equal((await catching(() => requirePlatformAdmin())).redirectTo, "/account?setup=2fa", "required unless switched off");
	await db.models.User.updateOne({ _id: root._id }, { $set: { "twoFactor.enabledAt": new Date() } });
	assert.equal((await requirePlatformAdmin()).twoFactorEnabled, true);
});

test("turning it off needs the password and a code, and administrators can't while it is required", async () => {
	const { turnOffTwoFactor } = await import("@/app/(app)/account/actions");
	const { secret } = await enable(a.owner);
	await loginAs(a.owner);
	fromNewAddress();

	assert.match((await turnOffTwoFactor(null, form({ password: "wrong password!!", code: await nextCode(secret) }))).error, /password is wrong/);
	assert.match((await turnOffTwoFactor(null, form({ password: PASSWORD, code: "000000" }))).error, /code isn't right/);
	assert.ok((await db.models.User.findById(a.owner._id)).twoFactor.enabledAt, "still on after the refused tries");
	assert.deepEqual(await turnOffTwoFactor(null, form({ password: PASSWORD, code: await nextCode(secret, 1) })), { ok: true });
	assertNoTwoFactor(await db.models.User.findById(a.owner._id));

	// An administrator under the requirement can't switch it off at all.
	const root = await db.models.User.create({ email: "root@platform.test", passwordHash: a.owner.passwordHash, isPlatformAdmin: true, twoFactor: { enabledAt: new Date() } });
	process.env.REQUIRE_ADMIN_2FA = "true";
	await loginAs(root);
	assert.match((await turnOffTwoFactor(null, form({ password: PASSWORD, code: "123456" }))).error, /must keep/);
	assert.ok((await db.models.User.findById(root._id)).twoFactor.enabledAt);
});

test("new recovery codes need a code from the app (not a recovery code) and replace the old ones", async () => {
	const { newRecoveryCodes } = await import("@/app/(app)/account/actions");
	const { secret, recoveryCodes } = await enable(a.owner);
	await loginAs(a.owner);
	fromNewAddress();

	assert.match((await newRecoveryCodes(null, form({ code: recoveryCodes[0] }))).error, /isn't right/, "a recovery code can't make more");
	const result = await newRecoveryCodes(null, form({ code: await nextCode(secret) }));
	assert.equal(result.ok, true);
	assert.equal(result.recoveryCodes.length, 10);
	assert.equal(result.recoveryCodes.some((code) => recoveryCodes.includes(code)), false);

	const { verifySecondFactor } = await import("@/lib/two-factor");
	assert.equal((await verifySecondFactor({ userId: a.owner._id, input: recoveryCodes[0] })).ok, false, "the old ones are dead");
	assert.equal((await verifySecondFactor({ userId: a.owner._id, input: result.recoveryCodes[0] })).ok, true);
});

test("an administrator can remove another person's second factor, which signs them out, but not their own", async () => {
	const { resetAccountTwoFactorAction } = await import("@/app/(app)/platform/actions");
	const { getSession } = await import("@/lib/auth");
	const root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true, twoFactor: { enabledAt: new Date() } });
	await enable(a.owner);

	const { jar } = await loginAs(a.editor);
	const cookies = new Map(jar);
	await loginAs(a.owner);
	assert.equal((await catching(() => resetAccountTwoFactorAction(id(a.owner)))).redirectTo, "/", "a client can't");

	process.env.REQUIRE_ADMIN_2FA = "true";
	await loginAs(root);
	assert.match((await resetAccountTwoFactorAction(id(root))).error, /own here/);
	assert.match((await resetAccountTwoFactorAction(id(a.editor))).error, /isn't on/);
	assert.deepEqual(await resetAccountTwoFactorAction(id(a.owner)), { ok: true });
	const owner = await db.models.User.findById(a.owner._id);
	assertNoTwoFactor(owner);
	assert.equal(owner.sessionVersion, 1);
	assert.equal(await db.models.AuditLog.countDocuments({ action: "account.2fa-reset" }), 1);
	void cookies;
	void getSession;
});

test("the accounts list says who has a second factor", async () => {
	const { listAccounts } = await import("@/lib/platform-accounts");
	await enable(a.owner);
	const { accounts } = await listAccounts();
	assert.equal(accounts.find(({ email }) => email === a.owner.email).hasTwoFactor, true);
	assert.equal(accounts.find(({ email }) => email === a.editor.email).hasTwoFactor, false);
	assert.equal(accounts.some((account) => "twoFactor" in account), false, "never the secret");
});
