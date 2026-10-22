import crypto from "node:crypto";

// Pure rules for two-factor login: time-based one-time codes (RFC 6238, the kind every authenticator app
// makes) and one-time recovery codes. Nothing here touches the database.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// A code is also accepted one step either side, for clocks that are a little off.
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes) {
	let bits = 0;
	let value = 0;
	let output = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			output += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
	return output;
}

export function base32Decode(text) {
	let bits = 0;
	let value = 0;
	const bytes = [];
	for (const character of String(text ?? "").toUpperCase().replace(/[\s=-]/g, "")) {
		const index = BASE32.indexOf(character);
		if (index === -1) return null;
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(bytes);
}

// 160 bits, the size an authenticator app expects.
export function generateTotpSecret() {
	return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBytes, counter) {
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const digest = crypto.createHmac("sha1", secretBytes).update(message).digest();
	const offset = digest[digest.length - 1] & 15;
	const binary = digest.readUInt32BE(offset) & 0x7fffffff;
	return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function getTotpStep(now = Date.now()) {
	return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

export function totpCodeAt(secret, step) {
	return hotp(base32Decode(secret), step);
}

// Only text counts: an array or an object that happens to print as six digits is not a code.
export function looksLikeTotpCode(input) {
	return typeof input === "string" && /^\d{6}$/.test(input.replace(/\s/g, ""));
}

// { ok, step } when the code is right for a step newer than lastUsedStep. A code that was already used (the
// same step, or an older one) is refused, so one shoulder-surfed code can't be replayed.
export function verifyTotp({ secret, code, now = Date.now(), lastUsedStep = -1 }) {
	if (!looksLikeTotpCode(code)) return { ok: false };
	const digits = code.replace(/\s/g, "");
	const secretBytes = base32Decode(secret);
	if (!secretBytes || secretBytes.length === 0) return { ok: false };
	const current = getTotpStep(now);
	for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
		if (step <= lastUsedStep) continue;
		const expected = Buffer.from(hotp(secretBytes, step));
		if (crypto.timingSafeEqual(expected, Buffer.from(digits))) return { ok: true, step };
	}
	return { ok: false };
}

// What an authenticator app scans.
export function buildOtpauthUri({ secret, email, issuer }) {
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
	return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

// Four groups of four so a code can be read out and typed: "k3f9-m2xq-7bd4-pw8h", 80 bits.
// No 0/1/i/l/o, which are easy to confuse.
const RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
	return Array.from({ length: count }, () => {
		const characters = Array.from(crypto.randomBytes(16), (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join("");
		return characters.match(/.{4}/g).join("-");
	});
}

// Typed with or without dashes, spaces or capitals.
export function normalizeRecoveryCode(input) {
	return (typeof input === "string" ? input : "").toLowerCase().replace(/[\s-]/g, "");
}

export function looksLikeRecoveryCode(input) {
	return /^[2-9a-hj-km-np-z]{16}$/.test(normalizeRecoveryCode(input));
}
