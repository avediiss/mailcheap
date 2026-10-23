// Custom contact fields: a workspace defines them (a plan, a company, a renewal date) and each contact can hold a
// value for each. They print in emails as {{key}} or {{key|fallback}} (lib/merge-tags.js). Pure rules only.

export const FIELD_TYPES = ["text", "number", "date"];
export const MAX_FIELDS_PER_WORKSPACE = 25;
export const MAX_TEXT_LENGTH = 200;
export const MAX_LABEL_LENGTH = 40;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/;
// Names that already mean something: a field can't take them.
export const RESERVED_FIELD_KEYS = new Set([
	"first_name", "last_name", "name", "email", "status", "tags", "source", "newsletter", "subscribed_at", "unsubscribed_at",
	"emails_sent", "opens", "clicks", "last_open_at", "unsubscribe", "unsubscribe_url", "web_url",
]);

// "Renewal date" -> "renewal_date"; accents and symbols dropped, starts with a letter.
export function fieldKeyFromLabel(label) {
	const key = String(label ?? "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/^[0-9_]+/, "")
		.slice(0, 30)
		.replace(/_+$/g, "");
	return key;
}

// The definition a person typed, checked: { key, label, type } or { error }.
export function readFieldDefinition({ label, type }, existingKeys = []) {
	const cleanLabel = String(label ?? "").replace(/\s+/g, " ").trim();
	if (!cleanLabel) return { error: "Give the field a name" };
	if (cleanLabel.length > MAX_LABEL_LENGTH) return { error: `Keep the name under ${MAX_LABEL_LENGTH} characters` };
	if (!FIELD_TYPES.includes(type)) return { error: "Pick a type: text, number or date" };
	const key = fieldKeyFromLabel(cleanLabel);
	if (!FIELD_KEY_PATTERN.test(key)) return { error: "Use letters in the name, so it can become a merge tag" };
	if (RESERVED_FIELD_KEYS.has(key)) return { error: `"${key}" is already used for something else. Pick another name.` };
	if (existingKeys.includes(key)) return { error: `There is already a field called ${key}` };
	if (existingKeys.length >= MAX_FIELDS_PER_WORKSPACE) return { error: `A workspace can have ${MAX_FIELDS_PER_WORKSPACE} fields` };
	return { key, label: cleanLabel, type };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(input) {
	const text = String(input ?? "").trim();
	if (!text) return null;
	// A date with or without a time of day: the day written is the day kept, whatever the server's time zone.
	const written = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(text)?.[1];
	if (written) {
		const date = new Date(`${written}T00:00:00Z`);
		return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== written ? null : written;
	}
	const time = Date.parse(text);
	if (!Number.isFinite(time)) return null;
	const date = new Date(time);
	const pad = (number) => String(number).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// One value for a field of this type: { value } (null for empty, meaning "clear it") or { error }.
export function normalizeFieldValue(type, input) {
	if (input === null || input === undefined || String(input).trim() === "") return { value: null };
	if (type === "number") {
		const number = typeof input === "number" ? input : Number(String(input).trim().replaceAll(",", ""));
		return Number.isFinite(number) && Math.abs(number) <= 1e15 ? { value: number } : { error: "Enter a number" };
	}
	if (type === "date") {
		const date = parseDate(input);
		return date ? { value: date } : { error: "Enter a date like 2026-10-23" };
	}
	if (typeof input === "object") return { error: "Enter text" };
	const text = String(input).replace(/[\r\n\t]+/g, " ").trim();
	return text.length <= MAX_TEXT_LENGTH ? { value: text } : { error: `Keep it under ${MAX_TEXT_LENGTH} characters` };
}

// A set of values from a form or the API against the workspace's definitions: { values: { key: value|null }, error }.
// Unknown keys are an error, not ignored, so a typo in an integration is noticed.
export function readFieldValues(definitions, input) {
	const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
	const values = {};
	for (const [key, raw] of Object.entries(input ?? {})) {
		const definition = byKey.get(key);
		if (!definition) return { error: `Unknown field: ${key}` };
		const parsed = normalizeFieldValue(definition.type, raw);
		if (parsed.error) return { error: `${definition.label}: ${parsed.error}` };
		values[key] = parsed.value;
	}
	return { values };
}

// How a stored value prints in an email: numbers with separators, dates written out.
export function formatFieldValue(value) {
	if (value === null || value === undefined || value === "") return "";
	if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "";
	const text = String(value);
	if (DATE_PATTERN.test(text)) {
		const date = new Date(`${text}T00:00:00Z`);
		if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
	}
	return text;
}
