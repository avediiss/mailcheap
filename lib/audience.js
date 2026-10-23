// Most engaged first, so warm-up sends capped by audienceLimit reach likely openers.
export const AUDIENCE_SORT = {
	lastClickAt: -1,
	lastOpenAt: -1,
	"imported.clickRate": -1,
	"imported.openRate": -1,
	createdAt: 1,
	_id: 1,
};

function normalizeLimit(audienceLimit) {
	const limit = Number(audienceLimit);
	return Number.isInteger(limit) && limit > 0 ? limit : null;
}

// A campaign's "To": everyone active, or only a label and/or a signup source (segment), or only some
// contacts picked by id, such as the people who didn't open an earlier issue (lib/non-openers.js).
export function normalizeSegment(segment) {
	const tag = String(segment?.tag ?? "").trim().toLowerCase();
	const source = String(segment?.source ?? "").trim();
	const segmentId = /^[a-f0-9]{24}$/i.test(String(segment?.segmentId ?? "")) ? String(segment.segmentId) : "";
	return { ...(tag && { tag }), ...(source && { source }), ...(segmentId && { segmentId }) };
}

export function buildAudienceQuery({ workspaceId, newsletterId, suppressedEmails = [], audienceLimit, segment, onlyContactIds, segmentFilter }) {
	const filter = { ...(workspaceId && { workspaceId }), newsletterId, status: "active" };
	if (suppressedEmails.length > 0) filter.email = { $nin: suppressedEmails };
	const { tag, source } = normalizeSegment(segment);
	if (tag) filter.tags = tag;
	if (source) filter.source = source;
	if (onlyContactIds) filter._id = { $in: onlyContactIds };
	// A saved segment's rules (lib/segments.js), added on top so they can never loosen the rest.
	if (segmentFilter && Object.keys(segmentFilter).length > 0) filter.$and = [segmentFilter];
	return { filter, sort: AUDIENCE_SORT, limit: normalizeLimit(audienceLimit) };
}

// A send to a part of the list isn't a regular issue: the list cleanup (lib/cleanup.js) skips it.
export function hasRestrictedAudience(audience) {
	return Boolean(audience?.nonOpenersOf) || Object.keys(normalizeSegment(audience)).length > 0;
}

// "Everyone", "Tagged vip", "From website", "Tagged vip · from website".
export function describeSegment(segment) {
	const { tag, source, segmentId } = normalizeSegment(segment);
	const parts = [tag && `tagged ${tag}`, source && `from ${source}`, segmentId && "a saved segment"].filter(Boolean);
	if (parts.length === 0) return "Everyone";
	const text = parts.join(" · ");
	return text[0].toUpperCase() + text.slice(1);
}

function readPath(document, path) {
	return path.split(".").reduce((value, key) => value?.[key], document);
}

function toComparable(value) {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "object") return String(value);
	return value;
}

// Same order as MongoDB: a missing value is the lowest, so it sorts last when descending.
function compareValues(left, right, direction) {
	const isLeftMissing = left == null;
	const isRightMissing = right == null;
	if (isLeftMissing || isRightMissing) {
		if (isLeftMissing && isRightMissing) return 0;
		return (isLeftMissing ? -1 : 1) * direction;
	}
	const a = toComparable(left);
	const b = toComparable(right);
	if (a === b) return 0;
	return (a < b ? -1 : 1) * direction;
}

export function compareByEngagement(left, right) {
	for (const [path, direction] of Object.entries(AUDIENCE_SORT)) {
		const result = compareValues(readPath(left, path), readPath(right, path), direction);
		if (result !== 0) return result;
	}
	return 0;
}

export function selectAudience(contacts, { suppressedEmails = [], audienceLimit, segment } = {}) {
	const suppressed = new Set(suppressedEmails);
	const limit = normalizeLimit(audienceLimit);
	const { tag, source } = normalizeSegment(segment);
	const audience = contacts
		.filter(({ status, email }) => status === "active" && !suppressed.has(email))
		.filter((contact) => !tag || contact.tags?.includes(tag))
		.filter((contact) => !source || contact.source === source)
		.toSorted(compareByEngagement);
	return limit ? audience.slice(0, limit) : audience;
}
