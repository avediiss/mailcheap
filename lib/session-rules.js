import crypto from "node:crypto";

// Pure rules for sessions and password-reset links. The database calls live in lib/auth.js and lib/password-reset.js.

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Signing out everywhere is one number: raise sessionVersion and every cookie issued before it stops working.
export function isSessionCurrent(user, claims) {
	if (!user || !claims) return false;
	if (user.disabledAt) return false;
	return (user.sessionVersion ?? 0) === claims.sessionVersion;
}

// The link carries the token; only its hash is stored, so a copy of the database can't reset anyone's password.
export function createResetToken() {
	const token = crypto.randomBytes(32).toString("base64url");
	return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token) {
	return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function getResetExpiry(now = Date.now()) {
	return new Date(now + RESET_TOKEN_TTL_MS);
}

export function looksLikeResetToken(token) {
	return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function normalizeLoginEmail(value) {
	return String(value ?? "").trim().toLowerCase().slice(0, 254);
}

// First start: the ADMIN_EMAIL/ADMIN_PASSWORD from the environment create the platform owner's account.
// After that the database is the only truth, so a changed password can't be bypassed with the old one.
export function isEnvAdminLogin({ email, password, env = process.env }) {
	if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return false;
	const emailOk = timingSafeEqualStrings(normalizeLoginEmail(email), normalizeLoginEmail(env.ADMIN_EMAIL));
	const passwordOk = timingSafeEqualStrings(String(password ?? ""), env.ADMIN_PASSWORD);
	return emailOk && passwordOk;
}

function timingSafeEqualStrings(a, b) {
	const digest = (value) => crypto.createHash("sha256").update(value).digest();
	return crypto.timingSafeEqual(digest(a), digest(b));
}
