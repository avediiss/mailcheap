import crypto from "node:crypto";
import { MAX_PASSWORD_LENGTH } from "./passwords-rules.js";

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, getPasswordProblem } from "./passwords-rules.js";

// Passwords are stored as "scrypt$N$r$p$salt$hash" (base64). The parameters travel with the hash, so they
// can be raised later without locking anyone out: old hashes still verify with the numbers they were made with.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
// A tampered hash can't make the server allocate gigabytes.
const MAX_N = 2 ** 17;
const MAX_MEMORY = 128 * 1024 * 1024;

function scrypt(password, salt, { N, r, p }) {
	return new Promise((resolve, reject) => {
		crypto.scrypt(String(password), salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEMORY }, (error, key) =>
			error ? reject(error) : resolve(key)
		);
	});
}

export async function hashPassword(password) {
	const salt = crypto.randomBytes(SALT_LENGTH);
	const key = await scrypt(password, salt, PARAMS);
	return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

function parseHash(stored) {
	const [scheme, n, r, p, salt, hash] = String(stored ?? "").split("$");
	if (scheme !== "scrypt" || !salt || !hash) return null;
	const params = { N: Number(n), r: Number(r), p: Number(p) };
	const isSane = Object.values(params).every(Number.isInteger) && params.N > 1 && params.N <= MAX_N && params.r > 0 && params.p > 0;
	if (!isSane) return null;
	return { params, salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
}

export async function verifyPassword(password, stored) {
	if (typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH) return false;
	const parsed = parseHash(stored);
	if (!parsed) return false;
	const key = await scrypt(password, parsed.salt, parsed.params);
	return key.length === parsed.hash.length && crypto.timingSafeEqual(key, parsed.hash);
}

let dummyHash;
// Runs the same work as a real check, so a login for an address that has no account takes as long as one that does.
export async function burnPasswordCheck(password) {
	dummyHash ??= await hashPassword("not-a-real-password");
	await verifyPassword(password, dummyHash);
}
