import assert from "node:assert/strict";
import { test } from "node:test";
import { readSite, readSiteUrl } from "../lib/gtm/site-reader.js";

// A stand-in for the network: pages by URL, so a whole site can be described in a test without one.
function fakeSite(pages) {
	const requested = [];
	const fetchImpl = async (url) => {
		requested.push(String(url));
		const page = pages[String(url)];
		if (!page) return new Response("gone", { status: 404 });
		if (page.throws) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
		return new Response(page.html ?? "", {
			status: page.status ?? 200,
			headers: { "content-type": page.type ?? "text/html; charset=utf-8", ...page.headers },
		});
	};
	return { fetchImpl, requested };
}

// Comfortably over the 300-character bar that marks a JavaScript-only shell, as a real landing page is.
const PITCH = `
	<p>Invoicing that chases late payers so freelancers do not have to. Built for designers who bill a
	handful of clients each month and hate writing the reminder email.</p>
	<p>Connect your bank, send an invoice, and let it do the chasing for you in your own words.</p>
	<p>Every reminder goes out in the tone you set, on the schedule you pick, and stops the moment the
	client pays. You see what was sent and when, and you can step in at any point.</p>
	<p>No contracts, no onboarding call, and nothing to install. Most people send their first invoice
	about four minutes after they sign up.</p>`;

test("a typed address without a protocol is understood", () => {
	assert.equal(readSiteUrl("acme.test").value, "https://acme.test/");
	assert.equal(readSiteUrl("  https://acme.test/pricing  ").value, "https://acme.test/pricing");
	// The fragment is noise for a page we are about to read as text.
	assert.equal(readSiteUrl("https://acme.test/#features").value, "https://acme.test/");
});

test("what isn't a website is refused before anything is fetched", () => {
	assert.match(readSiteUrl("").error, /Enter your product's web address/);
	assert.match(readSiteUrl("not a url at all").error, /doesn't look like a web address/);
	assert.match(readSiteUrl("ftp://acme.test").error, /http:\/\/ or https:\/\//);
	// No dot: a machine on the local network, not a product's site.
	assert.match(readSiteUrl("http://localhost:3000").error, /doesn't look like a web address/);
});

test("the page is read, and its pricing page followed", async () => {
	const { fetchImpl, requested } = fakeSite({
		"https://acme.test/": { html: `<title>Acme</title><nav><a href="/pricing">Pricing</a></nav>${PITCH}` },
		"https://acme.test/pricing": { html: "<h1>Plans</h1><p>Free for one client, then $9 a month.</p>" },
	});

	const { value, error } = await readSite("acme.test", { fetchImpl });

	assert.equal(error, undefined);
	assert.equal(value.title, "Acme");
	assert.match(value.siteText, /chases late payers/);
	assert.equal(value.pricingUrl, "https://acme.test/pricing");
	assert.match(value.pricingText, /\$9 a month/);
	assert.deepEqual(requested, ["https://acme.test/", "https://acme.test/pricing"]);
	assert.equal(value.needsDescription, false);
});

test("no pricing link means one request, not a guess at /pricing", async () => {
	const { fetchImpl, requested } = fakeSite({ "https://acme.test/": { html: PITCH } });

	const { value } = await readSite("acme.test", { fetchImpl });
	assert.equal(value.pricingUrl, null);
	assert.equal(value.pricingText, "");
	assert.equal(requested.length, 1);
});

test("a pricing page that won't load doesn't fail the whole read", async () => {
	const { fetchImpl } = fakeSite({
		"https://acme.test/": { html: `<nav><a href="/pricing">Pricing</a></nav>${PITCH}` },
		"https://acme.test/pricing": { status: 500 },
	});

	const { value, error } = await readSite("acme.test", { fetchImpl });
	assert.equal(error, undefined);
	assert.equal(value.pricingText, "", "the main page is still worth having");
});

test("a JavaScript-only site is flagged, not sent to the AI as a navigation bar", async () => {
	const { fetchImpl } = fakeSite({
		"https://acme.test/": { html: `<title>Acme</title><div id="root"></div><script>renderApp()</script>` },
	});

	const { value } = await readSite("acme.test", { fetchImpl });
	assert.equal(value.needsDescription, true);
	assert.ok(value.textLength < 300, `only ${value.textLength} characters of text`);
});

test("a site that never answers says so, with the timeout in the message", async () => {
	const { fetchImpl } = fakeSite({ "https://acme.test/": { throws: true } });

	const { error } = await readSite("acme.test", { fetchImpl, timeoutMs: 10_000 });
	assert.match(error, /didn't answer within 10 seconds/);
});

test("an error page, a missing page and a non-page all give a reason", async () => {
	const cases = [
		[{ "https://acme.test/": { status: 500 } }, /answered 500/],
		[{}, /answered 404/],
		[{ "https://acme.test/": { html: "%PDF-1.4", type: "application/pdf" } }, /isn't a web page/],
	];

	for (const [pages, expected] of cases) {
		const { fetchImpl } = fakeSite(pages);
		const { error } = await readSite("acme.test", { fetchImpl });
		assert.match(error, expected);
	}
});

test("a page that is too big is refused rather than read into memory twice", async () => {
	const { fetchImpl } = fakeSite({
		"https://acme.test/": { html: PITCH, headers: { "content-length": "9000000" } },
	});

	const { error } = await readSite("acme.test", { fetchImpl });
	assert.match(error, /too big to read/);
});

test("it says who is asking, so a site can block it deliberately", async () => {
	let sentHeaders;
	const fetchImpl = async (url, options) => {
		sentHeaders = options.headers;
		return new Response(PITCH, { headers: { "content-type": "text/html" } });
	};

	await readSite("acme.test", { fetchImpl });
	assert.match(sentHeaders["User-Agent"], /NamagGtmBot/);
});

test("the request is bounded by a timeout, always", async () => {
	let sentSignal;
	const fetchImpl = async (url, options) => {
		sentSignal = options.signal;
		return new Response(PITCH, { headers: { "content-type": "text/html" } });
	};

	await readSite("acme.test", { fetchImpl });
	assert.ok(sentSignal instanceof AbortSignal, "every outbound call carries one");
});
