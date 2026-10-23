import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAddress, findTypoSuggestion, getEmailDomain, isDisposableDomain, isUndeliverableDomain } from "../lib/address-quality.js";

test("typos of the big providers are caught, and real companies one letter away are not", () => {
	for (const [typo, meant] of [["gmial.com", "gmail.com"], ["gmail.con", "gmail.com"], ["hotmal.com", "hotmail.com"], ["yahooo.com", "yahoo.com"], ["outlok.com", "outlook.com"], ["icoud.com", "icloud.com"]]) {
		assert.equal(findTypoSuggestion(typo), meant, typo);
	}
	// Not in the list but one edit from a provider: still caught.
	assert.equal(findTypoSuggestion("gmaiil.com"), "gmail.com");
	assert.equal(findTypoSuggestion("hotmaol.com"), "hotmail.com");
	for (const real of ["gmail.com", "mail.com", "email.com", "gmx.com", "example.com", "acme.io", "hotmail.co.uk", "outlook.fr", "icloud.com"]) {
		assert.equal(findTypoSuggestion(real), null, real);
	}
});

test("disposable inboxes are recognised on their domain and on its subdomains", () => {
	assert.equal(isDisposableDomain("mailinator.com"), true);
	assert.equal(isDisposableDomain("sub.mailinator.com"), true);
	assert.equal(isDisposableDomain("MAILINATOR.COM"), true);
	assert.equal(isDisposableDomain("gmail.com"), false);
	assert.equal(isDisposableDomain("mailinator.com.example.org"), false, "a similar name is not the same domain");
	assert.equal(isDisposableDomain(""), false);
});

test("an address is judged in order: big providers pass, then typos, the platform's blocklist, throwaway inboxes", () => {
	assert.equal(classifyAddress("a@gmail.com"), null);
	assert.equal(classifyAddress("a@acme.io"), null);
	assert.equal(classifyAddress("a@gmial.com").reason, "typo");
	assert.match(classifyAddress("jane@gmial.com").message, /Did you mean jane@gmail\.com\?/);
	assert.equal(classifyAddress("a@mailinator.com").reason, "disposable");
	const blocked = new Set(["spam.example", "evil.test"]);
	assert.equal(classifyAddress("a@spam.example", { blocked }).reason, "blocked");
	assert.equal(classifyAddress("a@mail.evil.test", { blocked }).reason, "blocked", "subdomains too");
	assert.equal(classifyAddress("a@spam.example"), null, "no list, no block");
	assert.equal(classifyAddress("nodomain").reason, "undeliverable");
	assert.equal(getEmailDomain("A@Sub.Example.COM"), "sub.example.com");
});

test("a domain is undeliverable only when DNS says it has no mail and no address record", async () => {
	const missing = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
	const timeout = Object.assign(new Error("slow"), { code: "ETIMEOUT" });
	const resolver = ({ mx, a = [], aaaa = [] }) => ({
		resolveMx: async () => (mx instanceof Error ? Promise.reject(mx) : mx),
		resolve4: async () => (a instanceof Error ? Promise.reject(a) : a),
		resolve6: async () => (aaaa instanceof Error ? Promise.reject(aaaa) : aaaa),
	});
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: [{ exchange: "mx.x.test", priority: 10 }] })), false, "has a mail server");
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: missing, a: missing, aaaa: missing })), true, "nothing at all");
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: missing, a: ["1.2.3.4"] })), false, "no MX, but an address record receives mail");
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: [{ exchange: ".", priority: 0 }], a: ["1.2.3.4"] })), true, "null MX says no email");
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: timeout })), false, "a failed lookup proves nothing");
	assert.equal(await isUndeliverableDomain("x.test", resolver({ mx: missing, a: timeout })), false);
});
