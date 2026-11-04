import { GTM_LIMITS } from "./config.js";
import { findPricingUrl, htmlToText, readMetaDescription, readTitle } from "./html-text.js";

// Reads a founder's website: the page they gave us, plus its pricing page if it links to one. Returns the
// readable text and says when there is too little of it to describe a product, so the UI can ask the
// founder to paste a description instead of sending the AI a navigation bar.
//
// Relative imports and no "server-only": scripts/gtm-profiles.mjs (Phase 5) runs this under plain Node.

// Enough of a page to be a product description; under it, the site is a JavaScript shell.
const MIN_TEXT = GTM_LIMITS.minSiteTextLength;
const MAX_TEXT = GTM_LIMITS.maxSiteTextLength;
// A marketing page is tens of kilobytes. Past this, something else is being served.
const MAX_BYTES = 5_000_000;

// Only what a browser would follow from a typed address.
export function readSiteUrl(value) {
	const raw = String(value ?? "").trim();
	if (!raw) return { error: "Enter your product's web address" };

	// Founders type "acme.com", not "https://acme.com".
	const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	let url;
	try {
		url = new URL(withProtocol);
	} catch {
		return { error: "That doesn't look like a web address" };
	}
	if (!["http:", "https:"].includes(url.protocol)) return { error: "The address has to start with http:// or https://" };
	// A hostname with no dot is a machine on the local network, not a product's website.
	if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return { error: "That doesn't look like a web address" };

	url.hash = "";
	return { value: url.href };
}

// One page. Every outbound call is bounded, by time and by size.
async function fetchPage(url, { fetchImpl = fetch, timeoutMs = GTM_LIMITS.siteFetchTimeoutMs } = {}) {
	let response;
	try {
		response = await fetchImpl(url, {
			redirect: "follow",
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				// Say who is asking. A site that blocks us can then do it deliberately.
				"User-Agent": "NamagGtmBot/1.0 (+https://github.com/namag; reads a founder's own site for onboarding)",
				Accept: "text/html,application/xhtml+xml",
			},
		});
	} catch (error) {
		// A timeout arrives here as an AbortError; say which it was, since the founder sees this.
		const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
		return { error: isTimeout ? `The site didn't answer within ${Math.round(timeoutMs / 1000)} seconds` : "The site couldn't be reached" };
	}

	if (!response.ok) return { error: `The site answered ${response.status}` };

	const type = response.headers.get("content-type") ?? "";
	if (type && !/\b(?:text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(type)) {
		return { error: "That address isn't a web page" };
	}

	const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
	if (Number.isInteger(length) && length > MAX_BYTES) return { error: "That page is too big to read" };

	const html = await response.text();
	if (html.length > MAX_BYTES) return { error: "That page is too big to read" };
	return { value: html };
}

// The founder's site, read. `needsDescription` is the honest answer for a JavaScript-only site: we got the
// page, there was simply nothing in it to read, and the UI should ask them rather than guess.
export async function readSite(inputUrl, options = {}) {
	const checked = readSiteUrl(inputUrl);
	if (checked.error) return { error: checked.error };
	const url = checked.value;

	const page = await fetchPage(url, options);
	if (page.error) return { error: page.error };

	const html = page.value;
	const title = readTitle(html);
	const description = readMetaDescription(html);
	const pageText = htmlToText(html);

	// The pricing page is found in the raw HTML, not the stripped text: the link usually lives in the nav,
	// which htmlToText deliberately throws away.
	const pricingUrl = findPricingUrl(html, url);
	let pricingText = "";
	if (pricingUrl) {
		const pricingPage = await fetchPage(pricingUrl, options);
		// A pricing page that won't load is not worth failing the whole read for.
		if (pricingPage.value) pricingText = htmlToText(pricingPage.value).slice(0, MAX_TEXT);
	}

	// The title and meta description count as readable text: on a sparse page they are often all there is,
	// and they are usually the clearest sentence about what the product does.
	const siteText = [title, description, pageText].filter(Boolean).join("\n").slice(0, MAX_TEXT);

	return {
		value: {
			url,
			title,
			description,
			siteText,
			pricingUrl,
			pricingText,
			// Measured on the page itself, not including the pricing page: a site whose home page says
			// nothing still needs the founder's own words, however detailed its pricing table is.
			needsDescription: siteText.length < MIN_TEXT,
			textLength: siteText.length,
		},
	};
}
