import assert from "node:assert/strict";
import { test } from "node:test";
import {
	RECOVERY_CODE_COUNT,
	base32Decode,
	base32Encode,
	buildOtpauthUri,
	generateRecoveryCodes,
	generateTotpSecret,
	getTotpStep,
	looksLikeRecoveryCode,
	looksLikeTotpCode,
	normalizeRecoveryCode,
	totpCodeAt,
	verifyTotp,
} from "../lib/totp.js";

// RFC 6238 appendix B: the secret "12345678901234567890" (SHA-1). The RFC lists 8 digits; ours are the last 6.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC_VECTORS = [
	[59, "287082"],
	[1111111109, "081804"],
	[1111111111, "050471"],
	[1234567890, "005924"],
	[2000000000, "279037"],
	[20000000000, "353130"],
];

test("codes match the RFC 6238 test vectors", () => {
	assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
	for (const [seconds, code] of RFC_VECTORS) {
		assert.equal(totpCodeAt(RFC_SECRET, getTotpStep(seconds * 1000)), code, `at ${seconds}s`);
	}
});

test("base32 round-trips and refuses text that isn't base32", () => {
	for (const length of [1, 5, 10, 20, 33]) {
		const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) % 256));
		assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
	}
	assert.deepEqual(base32Decode("gezd gnbv-gy3t"), base32Decode("GEZDGNBVGY3T"), "case, spaces and dashes don't matter");
	assert.equal(base32Decode("not base32!"), null);
	const secret = generateTotpSecret();
	assert.match(secret, /^[A-Z2-7]{32}$/);
	assert.notEqual(secret, generateTotpSecret());
});

test("a code is accepted for its own step and one either side, never further", () => {
	const now = 1111111109 * 1000;
	const step = getTotpStep(now);
	const at = (offset) => totpCodeAt(RFC_SECRET, step + offset);
	assert.deepEqual(verifyTotp({ secret: RFC_SECRET, code: at(0), now }), { ok: true, step });
	assert.deepEqual(verifyTotp({ secret: RFC_SECRET, code: at(-1), now }), { ok: true, step: step - 1 });
	assert.deepEqual(verifyTotp({ secret: RFC_SECRET, code: at(1), now }), { ok: true, step: step + 1 });
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: at(-2), now }).ok, false);
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: at(2), now }).ok, false);
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: "000000", now }).ok, false);
});

test("a code that was already used can't be used again", () => {
	const now = 1111111109 * 1000;
	const step = getTotpStep(now);
	const first = verifyTotp({ secret: RFC_SECRET, code: totpCodeAt(RFC_SECRET, step), now });
	assert.equal(first.ok, true);
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: totpCodeAt(RFC_SECRET, step), now, lastUsedStep: first.step }).ok, false, "the same code, again");
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: totpCodeAt(RFC_SECRET, step - 1), now, lastUsedStep: first.step }).ok, false, "an older code after a newer one");
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: totpCodeAt(RFC_SECRET, step + 1), now, lastUsedStep: first.step }).ok, true, "the next one is fine");
});

test("input that isn't a six-digit code never passes, whatever it looks like", () => {
	const now = 1111111109 * 1000;
	const good = totpCodeAt(RFC_SECRET, getTotpStep(now));
	assert.equal(verifyTotp({ secret: RFC_SECRET, code: `${good.slice(0, 3)} ${good.slice(3)}`, now }).ok, true, "a space in the middle is fine");
	for (const bad of ["", null, undefined, "12345", "1234567", "abcdef", `${good}0`, [good], { toString: () => good }]) {
		assert.equal(verifyTotp({ secret: RFC_SECRET, code: bad, now }).ok, false, String(bad));
	}
	assert.equal(verifyTotp({ secret: "not base32!", code: good, now }).ok, false);
	assert.equal(verifyTotp({ secret: "", code: good, now }).ok, false);
	assert.equal(looksLikeTotpCode("123 456"), true);
	assert.equal(looksLikeTotpCode("12345a"), false);
});

test("the authenticator link names the app and the account, and carries the secret", () => {
	const uri = buildOtpauthUri({ secret: "ABC234", email: "a+b@x.test", issuer: "Namag" });
	assert.equal(uri, "otpauth://totp/Namag:a%2Bb%40x.test?secret=ABC234&issuer=Namag&algorithm=SHA1&digits=6&period=30");
});

test("recovery codes are many, different, easy to type and recognised however they are typed", () => {
	const codes = generateRecoveryCodes();
	assert.equal(codes.length, RECOVERY_CODE_COUNT);
	assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
	for (const code of codes) {
		assert.match(code, /^[2-9a-hj-km-np-z]{4}(-[2-9a-hj-km-np-z]{4}){3}$/);
		assert.equal(looksLikeRecoveryCode(code), true);
		assert.equal(normalizeRecoveryCode(` ${code.toUpperCase()} `), code.replaceAll("-", ""));
	}
	assert.equal(looksLikeRecoveryCode("1234-5678"), false);
	assert.equal(looksLikeRecoveryCode("123456"), false, "a six-digit code is not a recovery code");
	assert.equal(looksLikeRecoveryCode("0000-0000-0000-0000"), false, "0 and 1 are never used");
});
