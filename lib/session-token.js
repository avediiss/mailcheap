import { SignJWT, jwtVerify } from "jose";
import { MIN_SESSION_SECRET_LENGTH } from "./config.js";

// __Host- cookies need HTTPS, which local dev doesn't have.
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mailcheap_session" : "mailcheap_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

// After the password is right but before the second factor: proves the first step for a few minutes, nothing more.
export const CHALLENGE_COOKIE = process.env.NODE_ENV === "production" ? "__Host-mailcheap_2fa" : "mailcheap_2fa";
export const CHALLENGE_MAX_AGE = 5 * 60;

const encoder = new TextEncoder();
const cachedKeys = new Map();

// Email links derive their keys from SESSION_SECRET with other infos, so signing everyone out never breaks them.
async function getKey(purpose = "session") {
	const secret = process.env.SESSION_SECRET;
	if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
		throw new Error(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`);
	}
	if (cachedKeys.get(purpose)?.secret !== secret) {
		const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveBits"]);
		const bits = await crypto.subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(`mailcheap-${purpose}-v1`) },
			material,
			256
		);
		cachedKeys.set(purpose, { secret, key: new Uint8Array(bits) });
	}
	return cachedKeys.get(purpose).key;
}

// The cookie says who and which "sign-out-everywhere" number it was issued under. This only checks the
// signature, so the proxy can run it on every request; lib/auth.js getSession() then asks the database
// whether that person still exists, isn't disabled and still has that number (lib/session-rules.js).
export async function signSessionToken({ userId, sessionVersion = 0 }) {
	const key = await getKey();
	return new SignJWT({ uid: String(userId), sv: sessionVersion })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(`${SESSION_MAX_AGE}s`)
		.sign(key);
}

export async function verifySessionToken(token) {
	if (!token) return null;
	try {
		const key = await getKey();
		const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
		if (typeof payload.uid !== "string" || !/^[0-9a-f]{24}$/.test(payload.uid) || !Number.isInteger(payload.sv)) return null;
		return { userId: payload.uid, sessionVersion: payload.sv };
	} catch {
		return null;
	}
}

// A different key from the session's, so a session cookie can never pass as this and this never as a session.
// `next` is where to go after the second step; sessionVersion ties it to the password it was issued for.
export async function signChallengeToken({ userId, sessionVersion = 0, next = "/" }) {
	const key = await getKey("2fa-challenge");
	return new SignJWT({ uid: String(userId), sv: sessionVersion, next: String(next).slice(0, 200) })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(`${CHALLENGE_MAX_AGE}s`)
		.sign(key);
}

export async function verifyChallengeToken(token) {
	if (!token) return null;
	try {
		const key = await getKey("2fa-challenge");
		const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
		if (typeof payload.uid !== "string" || !/^[0-9a-f]{24}$/.test(payload.uid) || !Number.isInteger(payload.sv)) return null;
		return { userId: payload.uid, sessionVersion: payload.sv, next: typeof payload.next === "string" ? payload.next : "/" };
	} catch {
		return null;
	}
}
