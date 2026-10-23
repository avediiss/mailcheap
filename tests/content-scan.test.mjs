import assert from "node:assert/strict";
import { test } from "node:test";
import { extractLinks, scanContent, toPlainText } from "../lib/content-scan.js";
import { contentHash } from "../lib/content-hash.js";

const scan = (body, subject = "Hello", previewText = "") => scanContent({ subject, previewText, body });

test("an ordinary newsletter passes with nothing to say", () => {
	const result = scan('<p>This week: we shipped <a href="https://acme.io/changelog">a new editor</a>, and wrote about <a href="https://acme.io/blog/launch">how it went</a>.</p><p>Thanks for reading!</p>', "Field notes #14: the new editor");
	assert.deepEqual(result, { risk: "none", reasons: [], tips: [] });
	assert.equal(scan("Plain markdown with [a link](https://example.com/a) and more text.").risk, "none");
});

test("a link that shows one address and goes to another is a phishing sign, in HTML and in Markdown", () => {
	const html = scan('<p>Log in: <a href="https://paypa1-secure.example.net/login">https://www.paypal.com/login</a></p>');
	assert.equal(html.risk, "high");
	assert.match(html.reasons[0], /shows "https:\/\/www\.paypal\.com\/login" but goes to paypa1-secure\.example\.net/);
	assert.equal(scan("[paypal.com](https://evil.test/x)").risk, "high");
	// The same site, or one of its subdomains, is fine; plain words as link text are fine.
	assert.equal(scan('<a href="https://www.acme.io/pricing">acme.io/pricing</a> <a href="https://blog.acme.io/p">acme.io</a>').risk, "none");
	assert.equal(scan('<a href="https://evil.test">Read more</a>').risk, "none");
});

test("links to programs and scripts, and 'verify your account' pressure with a link, need a look", () => {
	assert.match(scan('<a href="https://files.example.com/invoice.exe">Download invoice</a>').reasons[0], /program or script/);
	assert.equal(scan('<a href="javascript:alert(1)">x</a>').risk, "high");
	const phishing = scan('<p>Your account has been suspended. Please verify your password to restore access.</p><a href="https://acme-login.example.net">Restore</a>');
	assert.equal(phishing.risk, "high");
	assert.match(phishing.reasons.join(" "), /verify or hand over account, password or payment details/);
	assert.equal(scan("Your account has been suspended. Verify your password.").risk, "none", "no link, no lure");
	assert.equal(scan('<p>We updated our privacy policy.</p><a href="https://acme.io/privacy">Read it</a>').risk, "none");
});

test("crypto wallet secrets and prize-with-a-fee scams are flagged, a mention of crypto is not", () => {
	assert.equal(scan("Send your seed phrase to claim the airdrop").risk, "high");
	assert.equal(scan("Double your bitcoin in 24 hours").risk, "high");
	assert.equal(scan("You have won the lottery! Pay the processing fee to claim your prize.").risk, "high");
	assert.equal(scan("Buy me 5 Google Play gift cards, I'm in a meeting").risk, "high");
	assert.equal(scan("This month's issue covers how bitcoin ETFs work and what a private key is.").risk, "high", "the phrase alone is enough for a human to check");
	assert.equal(scan("Why people love bitcoin and ethereum, a short history.").risk, "none");
	assert.equal(scan("You have won our reader of the month badge!").risk, "none", "no fee, no scam");
});

test("spam-filter tips are advice only: capitals, repeated marks, fake replies, spammy phrases, shorteners", () => {
	const result = scan('<p>100% FREE offer, act now! <a href="https://bit.ly/x">Click here</a></p>', "RE: BIG SALE!!! TODAY ONLY");
	assert.equal(result.risk, "none", "never blocks");
	assert.deepEqual(result.tips.map(({ id }) => id), ["caps", "punctuation", "fake-reply", "phrases", "shortener"]);
	assert.deepEqual(result.tips.find(({ id }) => id === "phrases").words, ["100% free", "act now", "click here"]);
	assert.deepEqual(scan("Hello", "Hi there").tips, []);
	assert.deepEqual(scan("hello", "OK").tips, [], "a short subject in capitals is fine");
});

test("links and text are read from HTML and Markdown, and the content hash changes with any part of the email", () => {
	assert.deepEqual(extractLinks('<p><a class="x" href="https://a.test/1">One &amp; two</a></p> and [three](https://b.test/3 "title")'), [
		{ href: "https://a.test/1", text: "One & two" },
		{ href: "https://b.test/3", text: "three" },
	]);
	assert.equal(toPlainText("<style>p{}</style><p>Hi&nbsp;<b>there</b></p>"), "Hi there");
	const hash = contentHash({ subject: "a", previewText: "b", body: "c" });
	assert.match(hash, /^[0-9a-f]{64}$/);
	assert.equal(contentHash({ subject: "a", previewText: "b", body: "c" }), hash);
	for (const changed of [{ subject: "x" }, { previewText: "x" }, { body: "x" }]) assert.notEqual(contentHash({ subject: "a", previewText: "b", body: "c", ...changed }), hash);
});
