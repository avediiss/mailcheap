// Personalization: {{first_name}} or {{first_name|friend}} in a subject or an email. Without a first name the
// text after "|" is used, and "there" when there isn't any ("Hi {{first_name}}," becomes "Hi there,").
const TAG_PATTERN = /\{\{\s*first_name\s*(?:\|\s*([^{}|]*?)\s*)?\}\}/gi;
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

// html: the value goes into HTML, so it's escaped. Line breaks never survive: a name can't add headers.
export function applyMergeTags(text, { firstName } = {}, { html = false } = {}) {
	if (typeof text !== "string" || !text.includes("{{")) return text;
	return text.replace(TAG_PATTERN, (_match, fallback) => {
		const value = (firstName?.trim() || fallback?.trim() || DEFAULT_FALLBACK).replace(/[\r\n]+/g, " ");
		return html ? escapeHtml(value) : value;
	});
}

// "Dana Smith" -> "Dana": a contact form's name field holds the full name.
export function toFirstName(value) {
	const name = String(value ?? "")
		.replace(/[\r\n\t]+/g, " ")
		.trim();
	return (name.split(/\s+/)[0] ?? "").slice(0, 60);
}
