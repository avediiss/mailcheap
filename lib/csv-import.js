import { FIELD_KEY_PATTERN, MAX_FIELDS_PER_WORKSPACE, MAX_TEXT_LENGTH } from "./contact-fields.js";
import { toFirstName } from "./merge-tags.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLUMN_ALIASES = {
	email: ["email", "emailaddress", "subscriberemail", "subscriber"],
	status: ["status", "subscriptionstatus", "subscriberstatus"],
	subscribedAt: [
		"createdat",
		"created",
		"subscribedat",
		"subscribedate",
		"subscriptiondate",
		"datesubscribed",
		"signupdate",
	],
	emailsReceived: ["emailsreceived", "totalemailsreceived", "received"],
	openRate: ["openrate", "uniqueopenrate", "totalopenrate"],
	clickRate: ["clickrate", "clickthroughrate", "uniqueclickrate", "ctr"],
	firstName: ["firstname", "first", "fname", "givenname", "name", "fullname"],
	tags: ["tags", "tag", "labels", "label", "segments", "segment"],
};

const STATUS_ALIASES = {
	active: "active",
	subscribed: "active",
	inactive: "unsubscribed",
	unsubscribed: "unsubscribed",
	bounced: "bounced",
	invalid: "bounced",
	hardbounce: "bounced",
	complained: "complained",
	spam: "complained",
	spamreport: "complained",
	pending: "dormant",
	validating: "dormant",
	needsattention: "dormant",
	dormant: "dormant",
};

// An import can only move a contact to a stricter status, never back to active.
export const STATUS_RANK = { active: 0, dormant: 1, unsubscribed: 2, bounced: 3, complained: 4 };

export const MAX_IMPORT_ROWS_PER_REQUEST = 1000;

function normalizeKey(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

// fieldDefs: the workspace's custom fields. A column whose name is a field's name or key is mapped to it.
export function mapColumns(headers, fieldDefs = []) {
	const normalized = headers.map((header) => [header, normalizeKey(header)]);
	const columns = Object.fromEntries(
		Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
			field,
			normalized.find(([, key]) => aliases.includes(key))?.[0] ?? null,
		])
	);
	const used = new Set(Object.values(columns).filter(Boolean));
	const fields = {};
	for (const { key, label } of fieldDefs) {
		const match = normalized.find(([header, normalizedHeader]) => !used.has(header) && (normalizedHeader === normalizeKey(key) || normalizedHeader === normalizeKey(label)));
		if (match) {
			fields[key] = match[0];
			used.add(match[0]);
		}
	}
	return { ...columns, fields };
}

export function normalizeEmail(value) {
	const email = String(value ?? "")
		.trim()
		.toLowerCase();
	return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeStatus(value) {
	if (value === undefined || value === null || String(value).trim() === "") return "active";
	return STATUS_ALIASES[normalizeKey(value)] ?? "dormant";
}

export function normalizeRate(value) {
	const text = String(value ?? "").trim();
	if (!text) return undefined;
	const number = Number.parseFloat(text.replace("%", ""));
	if (!Number.isFinite(number) || number < 0) return undefined;
	const rate = text.includes("%") || number > 1 ? number / 100 : number;
	return Math.min(rate, 1);
}

function normalizeCount(value) {
	const number = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
	return Number.isFinite(number) ? number : undefined;
}

function normalizeDate(value) {
	const time = Date.parse(String(value ?? ""));
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function normalizeImportRow(row, columns, { status: statusOverride } = {}) {
	const email = normalizeEmail(row[columns.email]);
	if (!email) return null;

	const fileStatus = columns.status ? normalizeStatus(row[columns.status]) : "active";
	const status =
		statusOverride && STATUS_RANK[statusOverride] > STATUS_RANK[fileStatus] ? statusOverride : fileStatus;

	return {
		email,
		status,
		subscribedAt: columns.subscribedAt ? normalizeDate(row[columns.subscribedAt]) : undefined,
		emailsReceived: columns.emailsReceived ? normalizeCount(row[columns.emailsReceived]) : undefined,
		openRate: columns.openRate ? normalizeRate(row[columns.openRate]) : undefined,
		clickRate: columns.clickRate ? normalizeRate(row[columns.clickRate]) : undefined,
		...optionalFields({
			firstName: columns.firstName ? row[columns.firstName] : undefined,
			tags: columns.tags ? row[columns.tags] : undefined,
			fields: readMappedFields(row, columns.fields),
		}),
	};
}

// The values of the columns mapped to custom fields, as the text the file has: they are typed later, against the
// workspace's definitions (lib/contact-fields.js).
function readMappedFields(row, mapping = {}) {
	const values = {};
	for (const [key, header] of Object.entries(mapping)) {
		const text = String(row[header] ?? "").trim();
		if (text) values[key] = text.slice(0, MAX_TEXT_LENGTH);
	}
	return values;
}

function optionalNumber(value, max) {
	const number = Number(value);
	return value === undefined || value === null || !Number.isFinite(number) || number < 0
		? undefined
		: Math.min(number, max);
}

export const MAX_TAGS_PER_CONTACT = 10;

// "VIP; Paris, press" or ["VIP", "Paris"] -> ["vip", "paris", "press"]: lowercase, letters, numbers, spaces,
// dashes and underscores only, at most 40 characters each and 10 per contact.
export function normalizeTags(value) {
	const list = Array.isArray(value) ? value : String(value ?? "").split(/[;,|]/);
	const tags = list
		.map((tag) =>
			String(tag ?? "")
				.toLowerCase()
				.replace(/[^\p{L}\p{N} _-]/gu, "")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 40)
		)
		.filter(Boolean);
	return [...new Set(tags)].slice(0, MAX_TAGS_PER_CONTACT);
}

// Custom field values from the browser: at most one per defined key, as short text or a number. What they mean is
// decided against the workspace's definitions when the row is imported.
function cleanFieldValues(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const clean = {};
	for (const [key, raw] of Object.entries(value).slice(0, MAX_FIELDS_PER_WORKSPACE)) {
		if (!FIELD_KEY_PATTERN.test(key)) continue;
		if (typeof raw === "number" && Number.isFinite(raw)) clean[key] = raw;
		else if (typeof raw === "string" && raw.trim()) clean[key] = raw.trim().slice(0, MAX_TEXT_LENGTH);
	}
	return clean;
}

// Only the fields a row has: a row without a name or tags looks exactly as it did before they existed.
function optionalFields({ firstName, tags, fields }) {
	const name = toFirstName(firstName);
	const labels = normalizeTags(tags);
	const values = cleanFieldValues(fields);
	return { ...(name && { firstName: name }), ...(labels.length > 0 && { tags: labels }), ...(Object.keys(values).length > 0 && { fields: values }) };
}

// Server side: rows come from the browser, so every field is checked again.
export function sanitizeImportRow(row) {
	const email = normalizeEmail(row?.email);
	if (!email || !Object.hasOwn(STATUS_RANK, row?.status)) return null;
	const subscribedAt = row.subscribedAt ? new Date(row.subscribedAt) : undefined;

	return {
		email,
		status: row.status,
		subscribedAt: subscribedAt && Number.isFinite(subscribedAt.getTime()) ? subscribedAt : undefined,
		emailsReceived: optionalNumber(row.emailsReceived, 1_000_000),
		openRate: optionalNumber(row.openRate, 1),
		clickRate: optionalNumber(row.clickRate, 1),
		...optionalFields(row),
	};
}
