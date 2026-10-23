// Saved segments: a name and a few rules ("tag is vip AND last opened in the last 30 days") that pick people out of
// a newsletter's list. A segment is a question, not a list: who is in it is worked out each time, so people join
// and leave it on their own. Pure rules; lib/segments-server.js counts and loads them.

export const MAX_CONDITIONS = 8;
export const MAX_SEGMENTS_PER_NEWSLETTER = 20;
export const MAX_NAME_LENGTH = 60;
const MAX_VALUE_LENGTH = 100;
const MAX_DAYS = 3650;
const DAY_MS = 24 * 60 * 60 * 1000;

const TEXT = "text";
const DAYS = "days";
const DATE = "date";
const NUMBER = "number";
const NONE = "none";

// op -> what kind of value it takes.
const OPS = {
	has: TEXT, hasNot: TEXT, is: TEXT, isNot: TEXT, contains: TEXT, startsWith: TEXT, endsWith: TEXT,
	isSet: NONE, isNotSet: NONE, never: NONE,
	inLast: DAYS, notInLast: DAYS, inNext: DAYS,
	before: DATE, after: DATE,
	atLeast: NUMBER, atMost: NUMBER, greaterThan: NUMBER, lessThan: NUMBER,
};

export const OP_LABELS = {
	has: "has", hasNot: "doesn't have", is: "is", isNot: "is not", contains: "contains", startsWith: "starts with", endsWith: "ends with",
	isSet: "is filled in", isNotSet: "is empty", never: "never",
	inLast: "in the last (days)", notInLast: "not in the last (days)", inNext: "in the next (days)",
	before: "is before", after: "is after",
	atLeast: "is at least", atMost: "is at most", greaterThan: "is more than", lessThan: "is less than",
};

// The built-in things a segment can ask about, and the ops each allows.
export const BUILT_IN_FIELDS = {
	tag: { label: "Tag", ops: ["has", "hasNot"] },
	source: { label: "Signup source", ops: ["is", "isNot"] },
	email: { label: "Email address", ops: ["contains", "startsWith", "endsWith"] },
	firstName: { label: "First name", ops: ["isSet", "isNotSet"] },
	subscribed: { label: "Joined", ops: ["inLast", "notInLast", "before", "after"] },
	opened: { label: "Last opened an email", ops: ["inLast", "notInLast", "never"] },
	clicked: { label: "Last clicked a link", ops: ["inLast", "notInLast", "never"] },
	missed: { label: "Issues in a row without opening or clicking", ops: ["atLeast"] },
	received: { label: "Emails received", ops: ["atLeast", "atMost"] },
	opens: { label: "Opens", ops: ["atLeast", "atMost"] },
};

const FIELD_OPS = {
	text: ["is", "isNot", "contains", "isSet", "isNotSet"],
	number: ["is", "greaterThan", "lessThan", "isSet", "isNotSet"],
	date: ["before", "after", "inLast", "inNext", "isSet", "isNotSet"],
};

// Everything a person can pick in the builder: built-ins, then the workspace's custom fields as "field:<key>".
export function getSegmentFields(fieldDefs = []) {
	return {
		...BUILT_IN_FIELDS,
		...Object.fromEntries(fieldDefs.map(({ key, label, type }) => [`field:${key}`, { label, ops: FIELD_OPS[type], type }])),
	};
}

export function valueKindOf(op) {
	return OPS[op] ?? NONE;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One condition from the browser, checked against what can be asked: { field, op, value } or { error }.
export function readCondition(input, fields) {
	const field = String(input?.field ?? "");
	const op = String(input?.op ?? "");
	const spec = fields[field];
	if (!spec) return { error: "One of the rules asks about something that doesn't exist (anymore)" };
	if (!spec.ops.includes(op)) return { error: `${spec.label} can't be "${OP_LABELS[op] ?? op}"` };
	const kind = valueKindOf(op);
	if (kind === NONE) return { field, op };
	const raw = input?.value;
	if (kind === TEXT) {
		const value = String(raw ?? "").replace(/\s+/g, " ").trim();
		if (!value) return { error: `${spec.label}: enter a value` };
		if (value.length > MAX_VALUE_LENGTH) return { error: `${spec.label}: keep it under ${MAX_VALUE_LENGTH} characters` };
		return { field, op, value: field === "tag" || field === "email" ? value.toLowerCase() : value };
	}
	if (kind === DAYS) {
		const days = Number(raw);
		return Number.isInteger(days) && days >= 1 && days <= MAX_DAYS ? { field, op, value: days } : { error: `${spec.label}: enter a number of days from 1 to ${MAX_DAYS}` };
	}
	if (kind === NUMBER) {
		const number = typeof raw === "number" ? raw : Number(String(raw ?? "").replaceAll(",", "").trim());
		return String(raw ?? "").trim() !== "" && Number.isFinite(number) && Math.abs(number) <= 1e12 ? { field, op, value: number } : { error: `${spec.label}: enter a number` };
	}
	const date = String(raw ?? "").trim();
	const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
	return valid ? { field, op, value: date } : { error: `${spec.label}: enter a date like 2026-10-23` };
}

// A whole segment from the builder: { name, match, conditions } or { error }.
export function readSegment(input, fieldDefs = []) {
	const name = String(input?.name ?? "").replace(/\s+/g, " ").trim();
	if (!name) return { error: "Give the segment a name" };
	if (name.length > MAX_NAME_LENGTH) return { error: `Keep the name under ${MAX_NAME_LENGTH} characters` };
	const match = input?.match === "any" ? "any" : "all";
	const list = Array.isArray(input?.conditions) ? input.conditions : [];
	if (list.length === 0) return { error: "Add at least one rule" };
	if (list.length > MAX_CONDITIONS) return { error: `A segment can have ${MAX_CONDITIONS} rules` };
	const fields = getSegmentFields(fieldDefs);
	const conditions = [];
	for (const condition of list) {
		const read = readCondition(condition, fields);
		if (read.error) return { error: read.error };
		conditions.push(read);
	}
	return { name, match, conditions };
}

function toDateString(time) {
	return new Date(time).toISOString().slice(0, 10);
}

// The MongoDB filter for one condition, or null when it can't be understood (it then matches nobody, never everybody).
function conditionFilter({ field, op, value }, now) {
	// Only what readSegment kept (text, numbers) is ever a value: anything else, such as an operator object, matches nobody.
	if (value !== undefined && value !== null && typeof value === "object") return null;
	const since = (days) => new Date(now - days * DAY_MS);
	const notEmpty = { $exists: true, $nin: [null, ""] };
	const empty = (path) => ({ $or: [{ [path]: { $exists: false } }, { [path]: null }, { [path]: "" }] });
	const regex = (pattern) => ({ $regex: pattern, $options: "i" });
	const dateFields = { subscribed: "subscribedAt", opened: "lastOpenAt", clicked: "lastClickAt" };

	if (field.startsWith("field:")) {
		const path = `fields.${field.slice(6)}`;
		const today = toDateString(now);
		switch (op) {
			case "is": return { [path]: value };
			case "isNot": return { [path]: { $ne: value } };
			case "contains": return { [path]: regex(escapeRegex(String(value))) };
			case "isSet": return { [path]: notEmpty };
			case "isNotSet": return empty(path);
			case "greaterThan": return { [path]: { $gt: value } };
			case "lessThan": return { [path]: { $lt: value } };
			case "before": return { [path]: { $lt: value } };
			case "after": return { [path]: { $gt: value } };
			case "inLast": return { [path]: { $gte: toDateString(now - value * DAY_MS), $lte: today } };
			case "inNext": return { [path]: { $gte: today, $lte: toDateString(now + value * DAY_MS) } };
			default: return null;
		}
	}
	switch (field) {
		case "tag": return op === "has" ? { tags: value } : { tags: { $ne: value } };
		case "source": return op === "is" ? { source: value } : { source: { $ne: value } };
		case "email": return { email: regex(op === "startsWith" ? `^${escapeRegex(value)}` : op === "endsWith" ? `${escapeRegex(value)}$` : escapeRegex(value)) };
		case "firstName": return op === "isSet" ? { firstName: notEmpty } : empty("firstName");
		case "subscribed":
		case "opened":
		case "clicked": {
			const path = dateFields[field];
			if (op === "never") return { [path]: null };
			if (op === "inLast") return { [path]: { $gte: since(value) } };
			if (op === "notInLast") return { $or: [{ [path]: null }, { [path]: { $lt: since(value) } }] };
			if (op === "before") return { [path]: { $lt: new Date(`${value}T00:00:00Z`) } };
			if (op === "after") return { [path]: { $gte: new Date(`${value}T00:00:00Z`) } };
			return null;
		}
		case "missed": return { ignoredIssues: { $gte: value } };
		case "received": return op === "atLeast" ? { "stats.sent": { $gte: value } } : { "stats.sent": { $lte: value } };
		case "opens": return op === "atLeast" ? { "stats.opens": { $gte: value } } : { "stats.opens": { $lte: value } };
		default: return null;
	}
}

// The filter for a whole segment, to be combined with the list's own (workspace, newsletter, status).
// An empty segment is everyone; a rule that can't be read matches nobody, so a broken segment never mails the
// whole list by mistake.
export function buildSegmentFilter(segment, { now = Date.now() } = {}) {
	const conditions = segment?.conditions ?? [];
	if (conditions.length === 0) return {};
	const parts = conditions.map((condition) => conditionFilter(condition, now) ?? { _id: null });
	return segment.match === "any" ? { $or: parts } : { $and: parts };
}

// "Tag has vip", "Last opened an email in the last (days) 30".
export function describeCondition({ field, op, value }, fields) {
	const label = fields[field]?.label ?? field;
	const days = valueKindOf(op) === DAYS;
	const phrase = { inLast: "in the last", notInLast: "not in the last", inNext: "in the next" }[op];
	if (days) return `${label} ${phrase} ${value} ${value === 1 ? "day" : "days"}`;
	const text = OP_LABELS[op] ?? op;
	return valueKindOf(op) === NONE ? `${label} ${text}` : `${label} ${text} ${value}`;
}

export function describeSegmentRules(segment, fieldDefs = []) {
	const fields = getSegmentFields(fieldDefs);
	const joiner = segment.match === "any" ? " or " : " and ";
	return segment.conditions.map((condition) => describeCondition(condition, fields)).join(joiner);
}
