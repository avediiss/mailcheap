import { formatFieldValue } from "./contact-fields.js";

// Personalization: {{first_name}} or {{first_name|friend}} in a subject or an email, and {{key}} / {{key|fallback}}
// for a custom field the workspace has defined (lib/contact-fields.js). Without a value the text after "|" is
// used; a first name falls back to "there" ("Hi {{first_name}}," becomes "Hi there,") and a field to nothing.
// A tag that is neither first_name nor a defined field is left exactly as written.
const TAG_PATTERN = /\{\{\s*([a-z][a-z0-9_]{0,29})\s*(?:\|\s*([^{}|]*?)\s*)?\}\}/gi;
const DEFAULT_FALLBACK = "there";

export const MERGE_TAG_EXAMPLE = "{{first_name}}";

function escapeHtml(value) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function hasMergeTags(text) {
	TAG_PATTERN.lastIndex = 0;
	return typeof text === "string" && text.includes("{{") && TAG_PATTERN.test(text);
}

// The keys of every tag in a text, lowercase, once each: to warn about one nobody defined.
export function findMergeTagKeys(text) {
	if (typeof text !== "string" || !text.includes("{{")) return [];
	return [...new Set([...text.matchAll(TAG_PATTERN)].map(([, key]) => key.toLowerCase()))];
}

// fields: this contact's values by key. fieldKeys: every key the workspace has defined, so a defined field the
// contact has no value for is still filled in (with its fallback), while an undefined tag is left alone.
// html: the value goes into HTML, so it's escaped. Line breaks never survive: a value can't add headers.
export function applyMergeTags(text, { firstName, fields, fieldKeys = [] } = {}, { html = false } = {}) {
	if (typeof text !== "string" || !text.includes("{{")) return text;
	return text.replace(TAG_PATTERN, (match, rawKey, fallback) => {
		const key = rawKey.toLowerCase();
		let value;
		if (key === "first_name") {
			value = firstName?.trim() || fallback?.trim() || DEFAULT_FALLBACK;
		} else if (fieldKeys.includes(key) || (fields && Object.hasOwn(fields, key))) {
			value = formatFieldValue(fields?.[key]) || fallback?.trim() || "";
		} else {
			return match;
		}
		value = value.replace(/[\r\n]+/g, " ");
		return html ? escapeHtml(value) : value;
	});
}

export function toFirstName(value) {
	const name = String(value ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.trim();
	return (name.split(/\s+/)[0] ?? "").slice(0, 60);
}
