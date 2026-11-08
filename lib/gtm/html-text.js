// Readable text out of a page of HTML, and the links worth following. No DOM parser: this runs on a founder's
// marketing page, where what matters is the prose, and a regex pass over a 200KB page costs nothing.
// sanitize-html is already a dependency but is built to produce safe HTML, not to strip a page to its words.
//
// Kept pure and dependency-free so it can be unit-tested over real page shapes without a network or a DB.

// Removed with their contents: nothing in them is the product's description.
// "title" is among them because readTitle() reads it separately: left in, it would reach the AI twice.
const DROPPED_ELEMENTS = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "header", "footer", "form", "title"];
// Dropped by role too: a cookie banner or a site menu is nav wherever it sits in the markup.
const DROPPED_ROLES = ["navigation", "banner", "contentinfo", "complementary", "dialog", "menu", "menubar"];

const ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	rsquo: "’",
	lsquo: "‘",
	ldquo: "“",
	rdquo: "”",
};

export function decodeEntities(text) {
	return String(text ?? "")
		.replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number.parseInt(code, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => safeCodePoint(Number.parseInt(code, 16)))
		.replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code) {
	// A page with a broken entity shouldn't throw on the way to the AI.
	return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

function dropElementsWithContent(html) {
	let output = html;
	for (const tag of DROPPED_ELEMENTS) {
		// Unclosed tags happen; stopping at the next matching close or the end of the document is the
		// forgiving reading, and losing the tail of a broken page is better than keeping a script in it.
		output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(?:</${tag}\\s*>|$)`, "gi"), " ");
		output = output.replace(new RegExp(`<${tag}\\b[^>]*/>`, "gi"), " ");
	}
	for (const role of DROPPED_ROLES) {
		output = output.replace(new RegExp(`<(\\w+)\\b[^>]*\\brole\\s*=\\s*["']?${role}["']?[^>]*>[\\s\\S]*?</\\1\\s*>`, "gi"), " ");
	}
	// aria-hidden content is decoration the page itself says not to read.
	output = output.replace(/<(\w+)\b[^>]*\baria-hidden\s*=\s*["']?true["']?[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
	return output;
}

// Tags that end a line of prose, so sentences from different blocks don't run together.
const BLOCK_TAGS = /<\/?(?:p|div|section|article|main|aside|h[1-6]|li|ul|ol|tr|td|th|table|br|hr|blockquote|pre|figure|figcaption|dd|dt|dl)\b[^>]*>/gi;

export function htmlToText(html) {
	const withoutDropped = dropElementsWithContent(String(html ?? ""));
	const text = withoutDropped
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(BLOCK_TAGS, "\n")
		.replace(/<[^>]*>/g, " ");

	return (
		decodeEntities(text)
			// Collapse runs of spaces and tabs, but keep the line breaks the block tags left.
			.replace(/[^\S\n]+/g, " ")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			// A marketing page repeats its tagline in the hero, the meta tags and the footer; the AI does
			// not need it three times, and the duplicate crowds out the rest of the page.
			.filter((line, index, lines) => line.length > 2 && lines.indexOf(line) === index)
			.join("\n")
			.trim()
	);
}

// What the page says its title is, which is often the clearest statement of what the product is.
export function readTitle(html) {
	const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ""));
	return title ? decodeEntities(title[1]).replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

export function readMetaDescription(html) {
	const meta =
		/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(String(html ?? "")) ??
		/<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']description["']/i.exec(String(html ?? ""));
	return meta ? decodeEntities(meta[1]).replace(/\s+/g, " ").trim().slice(0, 500) : "";
}

// Every href on the page, resolved against the page's own URL. Invalid and non-HTTP links are dropped
// rather than thrown on: a mailto: or a malformed href is normal on a real site.
export function readLinks(html, baseUrl) {
	const links = [];
	for (const [, href] of String(html ?? "").matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
		try {
			const url = new URL(decodeEntities(href), baseUrl);
			if (["http:", "https:"].includes(url.protocol)) links.push(url);
		} catch {
			continue;
		}
	}
	return links;
}

// The pricing page, if the site links to one. Matched on the words the link or its URL uses, and kept to
// the site's own host: a "pricing" link pointing at a payment provider is not this product's pricing.
export function findPricingUrl(html, baseUrl) {
	const base = new URL(baseUrl);
	const candidates = String(html ?? "").matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

	for (const [, href, label] of candidates) {
		const text = decodeEntities(label).replace(/<[^>]*>/g, " ").toLowerCase();
		let url;
		try {
			url = new URL(decodeEntities(href), baseUrl);
		} catch {
			continue;
		}
		if (url.host !== base.host || !["http:", "https:"].includes(url.protocol)) continue;

		const path = url.pathname.toLowerCase();
		if (/\b(pricing|plans)\b/.test(text) || /(^|\/|-)(pricing|plans)(\/|-|$)/.test(path)) {
			// The same page the founder gave us is not a separate pricing page.
			if (url.href.replace(/#.*$/, "") === base.href.replace(/#.*$/, "")) continue;
			return url.href;
		}
	}
	return null;
}
