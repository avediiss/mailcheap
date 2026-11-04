import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, findPricingUrl, htmlToText, readLinks, readMetaDescription, readTitle } from "../lib/gtm/html-text.js";

test("scripts and styles go, with their contents", () => {
	const html = `<p>Real text here.</p><script>var pitch = "fake pitch";</script><style>p{color:red}</style>`;
	const text = htmlToText(html);

	assert.match(text, /Real text here\./);
	assert.doesNotMatch(text, /fake pitch/);
	assert.doesNotMatch(text, /color:red/);
});

test("the chrome goes too: nav, header, footer and forms", () => {
	const html = `
		<header>Log in Sign up</header>
		<nav><a href="/features">Features</a><a href="/pricing">Pricing</a></nav>
		<main><p>Invoicing built for freelancers who hate chasing payments.</p></main>
		<form><label>Email</label><input></form>
		<footer>© 2026 Acme. Terms. Privacy.</footer>`;
	const text = htmlToText(html);

	assert.match(text, /Invoicing built for freelancers/);
	for (const chrome of ["Log in", "Features", "Terms", "Privacy", "Email"]) {
		assert.doesNotMatch(text, new RegExp(chrome), `${chrome} is chrome, not the product's description`);
	}
});

test("content the page itself hides is not read", () => {
	const html = `<div aria-hidden="true">decorative</div><div role="dialog">Accept cookies?</div><p>The actual pitch.</p>`;
	const text = htmlToText(html);

	assert.equal(text, "The actual pitch.");
});

test("an unclosed script doesn't leak code into the text", () => {
	// Real pages are malformed. Losing the tail is better than feeding the model JavaScript.
	const text = htmlToText(`<p>Before.</p><script>var a = 1;`);
	assert.match(text, /Before\./);
	assert.doesNotMatch(text, /var a/);
});

test("blocks become lines, so sentences don't run together", () => {
	assert.equal(htmlToText("<p>One.</p><p>Two.</p>"), "One.\nTwo.");
	assert.equal(htmlToText("<li>One</li><li>Two</li>"), "One\nTwo");
	assert.equal(htmlToText("First<br>Second"), "First\nSecond");
});

test("a tagline repeated across the page is kept once", () => {
	// Marketing pages say the same line in the hero, the body and the closing call to action.
	const text = htmlToText("<p>Invoicing for freelancers.</p><h2>Invoicing for freelancers.</h2><p>Something else.</p>");
	assert.equal(text, "Invoicing for freelancers.\nSomething else.");
});

test("entities are decoded, including numeric ones", () => {
	assert.equal(decodeEntities("Tom &amp; Jerry&nbsp;&mdash; &#65;&#x42;"), "Tom & Jerry — AB");
	// A broken entity must not throw on the way to the AI.
	assert.equal(decodeEntities("&#99999999999;"), "");
	assert.equal(decodeEntities("&notareal;"), "&notareal;");
});

test("the title and meta description are read separately, and not left in the body text", () => {
	const html = `<title>Acme &mdash; invoicing</title><meta name="description" content="For freelancers"><p>Body.</p>`;

	assert.equal(readTitle(html), "Acme — invoicing");
	assert.equal(readMetaDescription(html), "For freelancers");
	// They are passed to the prompt on their own, so leaving them here would send them twice.
	assert.equal(htmlToText(html), "Body.");
});

test("a meta description with its attributes the other way round is still found", () => {
	assert.equal(readMetaDescription(`<meta content="Backwards" name="description">`), "Backwards");
});

test("links are resolved against the page, and the ones a browser wouldn't follow are dropped", () => {
	const html = `
		<a href="/a">A</a>
		<a href="https://other.test/b">B</a>
		<a href="mailto:x@y.test">Mail</a>
		<a href="javascript:void(0)">Menu</a>
		<a href="http://">Malformed</a>`;
	const links = readLinks(html, "https://acme.test/home").map((url) => url.href);

	assert.deepEqual(links, ["https://acme.test/a", "https://other.test/b"]);
});

test("the pricing page is found by the link's words or its path", () => {
	const base = "https://acme.test/";
	assert.equal(findPricingUrl(`<a href="/pricing">Pricing</a>`, base), "https://acme.test/pricing");
	assert.equal(findPricingUrl(`<a href="/plans">Our plans</a>`, base), "https://acme.test/plans");
	assert.equal(findPricingUrl(`<a href="/what-it-costs">Pricing</a>`, base), "https://acme.test/what-it-costs");
	assert.equal(findPricingUrl(`<a href="/pricing-and-plans">See more</a>`, base), "https://acme.test/pricing-and-plans");
});

test("a pricing link is found in the nav, which the text pass throws away", () => {
	// The link almost always lives in the nav, so this runs on the raw HTML on purpose.
	const html = `<nav><a href="/pricing">Pricing</a></nav><p>Body.</p>`;
	assert.equal(findPricingUrl(html, "https://acme.test/"), "https://acme.test/pricing");
	assert.equal(htmlToText(html), "Body.");
});

test("a pricing link off the site, or back to the same page, is not followed", () => {
	// A "Pricing" link pointing at a payment provider is not this product's pricing.
	assert.equal(findPricingUrl(`<a href="https://stripe.com/pricing">Pricing</a>`, "https://acme.test/"), null);
	assert.equal(findPricingUrl(`<a href="/#pricing">Pricing</a>`, "https://acme.test/"), null);
	assert.equal(findPricingUrl(`<a href="/features">Features</a>`, "https://acme.test/"), null);
});

test("a page with nothing readable gives an empty string, not a crash", () => {
	assert.equal(htmlToText(""), "");
	assert.equal(htmlToText(undefined), "");
	assert.equal(htmlToText("<script>everything()</script>"), "");
});
