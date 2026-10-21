import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPasswordResetEmail } from "../lib/password-reset-email.js";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, getPasswordProblem } from "../lib/passwords-rules.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/passwords.js";
import {
	RESET_TOKEN_TTL_MS,
	createResetToken,
	getResetExpiry,
	hashResetToken,
	isEnvAdminLogin,
	isSessionCurrent,
	looksLikeResetToken,
	normalizeLoginEmail,
} from "../lib/session-rules.js";

test("a password verifies against its own hash and nothing else", async () => {
	const hash = await hashPassword("correct horse battery staple");
	assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
	assert.equal(await verifyPassword("correct horse battery staple", hash), true);
	assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
	assert.equal(await verifyPassword("", hash), false);
	assert.equal(await verifyPassword(undefined, hash), false);
});

test("the same password gets a different hash every time (random salt)", async () => {
	const [a, b] = await Promise.all([hashPassword("the same password"), hashPassword("the same password")]);
	assert.notEqual(a, b);
	assert.equal(await verifyPassword("the same password", a), true);
	assert.equal(await verifyPassword("the same password", b), true);
});

test("hashes made with other parameters still verify, and broken or hostile ones never do", async () => {
	const hash = await hashPassword("some long password");
	const [, , , , salt, key] = hash.split("$");
	assert.equal(await verifyPassword("some long password", ["scrypt", 16384, 8, 1, salt, key].join("$")), true);
	for (const bad of ["", null, undefined, "plain-text", "bcrypt$10$a$b", "scrypt$16384$8$1", `scrypt$${2 ** 30}$8$1$${salt}$${key}`, `scrypt$0$8$1$${salt}$${key}`, `scrypt$x$8$1$${salt}$${key}`]) {
		assert.equal(await verifyPassword("some long password", bad), false, String(bad));
	}
});

test("absurdly long passwords are refused before any hashing work", async () => {
	const hash = await hashPassword("a normal password");
	assert.equal(await verifyPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), hash), false);
	assert.match(getPasswordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1)), /at most/);
	await burnPasswordCheck("anything");
});

test("new passwords need a sensible length", () => {
	assert.match(getPasswordProblem("short"), new RegExp(`at least ${MIN_PASSWORD_LENGTH}`));
	assert.equal(getPasswordProblem("x".repeat(MIN_PASSWORD_LENGTH)), null);
	assert.match(getPasswordProblem(undefined), /at least/);
});

test("a session is current only while the person exists, is enabled and has the same sign-out number", () => {
	const user = { sessionVersion: 2 };
	assert.equal(isSessionCurrent(user, { sessionVersion: 2 }), true);
	assert.equal(isSessionCurrent(user, { sessionVersion: 1 }), false, "a password change signed this cookie out");
	assert.equal(isSessionCurrent({}, { sessionVersion: 0 }), true, "an account made before the number existed counts as 0");
	assert.equal(isSessionCurrent({ sessionVersion: 0, disabledAt: new Date() }, { sessionVersion: 0 }), false);
	assert.equal(isSessionCurrent(null, { sessionVersion: 0 }), false);
	assert.equal(isSessionCurrent(user, null), false);
});

test("reset tokens are random, stored only as a hash, and expire after an hour", () => {
	const a = createResetToken();
	const b = createResetToken();
	assert.notEqual(a.token, b.token);
	assert.equal(looksLikeResetToken(a.token), true);
	assert.equal(a.tokenHash, hashResetToken(a.token));
	assert.notEqual(a.tokenHash, a.token);
	assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
	const now = Date.UTC(2026, 9, 19, 12);
	assert.equal(getResetExpiry(now).getTime() - now, RESET_TOKEN_TTL_MS);
	assert.equal(RESET_TOKEN_TTL_MS, 60 * 60 * 1000);
});

test("anything that isn't a reset token is turned away before the database", () => {
	for (const bad of [undefined, null, "", "short", "x".repeat(44), `${"a".repeat(42)}!`, { $ne: "" }, ["a".repeat(43)]]) {
		assert.equal(looksLikeResetToken(bad), false);
	}
});

test("the first start creates the owner from the environment, and only for the exact email and password", () => {
	const env = { ADMIN_EMAIL: "Owner@Example.com", ADMIN_PASSWORD: "a long admin password" };
	assert.equal(isEnvAdminLogin({ email: "owner@example.com", password: "a long admin password", env }), true);
	assert.equal(isEnvAdminLogin({ email: " OWNER@example.com ", password: "a long admin password", env }), true);
	assert.equal(isEnvAdminLogin({ email: "owner@example.com", password: "a long admin passwor", env }), false);
	assert.equal(isEnvAdminLogin({ email: "other@example.com", password: "a long admin password", env }), false);
	assert.equal(isEnvAdminLogin({ email: "owner@example.com", password: "", env }), false);
	assert.equal(isEnvAdminLogin({ email: "owner@example.com", password: "x", env: {} }), false);
	assert.equal(normalizeLoginEmail("  Dana@Example.COM "), "dana@example.com");
	assert.equal(normalizeLoginEmail(undefined), "");
});

test("the reset email links to the reset page, says how long it works, and escapes the name", () => {
	const email = buildPasswordResetEmail({ url: "https://app.example.com/reset-password?token=abc", name: "<b>Dana</b>" });
	assert.equal(email.subject, "Reset your password");
	assert.ok(email.text.includes("https://app.example.com/reset-password?token=abc"));
	assert.ok(email.text.includes("60 minutes"));
	assert.ok(!email.html.includes("<b>Dana</b>"));
	assert.ok(email.html.includes("&lt;b&gt;Dana&lt;/b&gt;"));
	assert.ok(buildPasswordResetEmail({ url: "https://x.test/", name: "" }).text.startsWith("Hi,"));
});
