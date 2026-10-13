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

export function mapColumns(headers) {
	const normalized = headers.map((header) => [header, normalizeKey(header)]);
	return Object.fromEntries(
		Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
			field,
			normalized.find(([, key]) => aliases.includes(key))?.[0] ?? null,
		])
	);
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
		}),
	};
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

// Only the fields a row has: a row without a name or tags looks exactly as it did before they existed.
function optionalFields({ firstName, tags }) {
	const name = toFirstName(firstName);
	const labels = normalizeTags(tags);
	return { ...(name && { firstName: name }), ...(labels.length > 0 && { tags: labels }) };
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
