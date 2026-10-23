// Pure rules for how fast a workspace may send. A new sender's emails go out in small, growing amounts so the
// shared sending reputation isn't spent in one go; an established one is held to a multiple of what it has sent
// before. The server side (lib/send-plan-server.js) gathers the numbers; sending.js applies the plan.

const DAY_MS = 24 * 60 * 60 * 1000;

export const WARMUP_START = 200;
export const WARMUP_DAYS = 30;
// The daily amount doubles every three days of the first month: 200, 400, 800... a new sender reaches a few
// thousand by the end of the second week and tens of thousands by the fourth.
export const WARMUP_DOUBLING_DAYS = 3;
// After the first month a workspace may send up to five times its busiest recent day, and never fewer than this.
export const GROWTH_FACTOR = 5;
export const ESTABLISHED_FLOOR = 2000;
// A send is spread over at most this many days; the rest waits for "send to more".
export const MAX_SPREAD_DAYS = 3;

// People who have never had an email from the workspace: more than this many in one send, and only a small slice
// goes first, the rest 3 hours later if the slice looked healthy.
export const NEW_CONTACT_THRESHOLD = 200;
export const SLICE_RATIO = 0.05;
export const SLICE_MIN = 200;
export const SLICE_MAX = 2000;
export const SECOND_WAVE_DELAY_SECONDS = 3 * 60 * 60;
// New days start a little after midnight UTC, once the day's count has certainly reset.
const NEW_DAY_MARGIN_SECONDS = 5 * 60;

// How many emails a workspace may send in one UTC day. Infinity when the platform trusts it.
// isWatch: its bounces or complaints are already close to the limits, so it doesn't grow.
export function getDailySendCap({ firstSentAt, now = new Date(), largestRecentDay = 0, isTrusted = false, capOverride = null, isWatch = false } = {}) {
	if (isTrusted) return Number.POSITIVE_INFINITY;
	if (Number.isFinite(capOverride) && capOverride > 0) return Math.floor(capOverride);
	const age = firstSentAt ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(firstSentAt).getTime()) / DAY_MS)) : 0;
	let cap =
		age < WARMUP_DAYS
			? WARMUP_START * 2 ** Math.floor(age / WARMUP_DOUBLING_DAYS)
			: Math.max(ESTABLISHED_FLOOR, GROWTH_FACTOR * largestRecentDay);
	if (isWatch) cap = Math.min(cap, Math.max(WARMUP_START, largestRecentDay));
	return Math.ceil(cap);
}

// Day 1 of the first month is "day 1", for people.
export function getWarmupDay({ firstSentAt, now = new Date() }) {
	if (!firstSentAt) return 1;
	return Math.floor((new Date(now).getTime() - new Date(firstSentAt).getTime()) / DAY_MS) + 1;
}

export function startOfUtcDay(now = new Date()) {
	const date = new Date(now);
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function secondsUntilNextUtcDay(now = new Date()) {
	const next = startOfUtcDay(now).getTime() + DAY_MS;
	return Math.ceil((next - new Date(now).getTime()) / 1000) + NEW_DAY_MARGIN_SECONDS;
}

export function getRemainingToday({ cap, sentToday }) {
	return Number.isFinite(cap) ? Math.max(0, cap - sentToday) : Number.POSITIVE_INFINITY;
}

// The most emails one send may reach: what is left today and the full allowance of the next days.
export function getMaxRecipients({ cap, sentToday }) {
	if (!Number.isFinite(cap)) return Number.POSITIVE_INFINITY;
	return getRemainingToday({ cap, sentToday }) + (MAX_SPREAD_DAYS - 1) * cap;
}

// 0 for today, 1 for tomorrow... for the email at `position` (0 is the first) in a send queued now.
export function getDayIndex({ position, cap, sentToday }) {
	if (!Number.isFinite(cap)) return 0;
	const remaining = getRemainingToday({ cap, sentToday });
	return position < remaining ? 0 : 1 + Math.floor((position - remaining) / cap);
}

export function getDayDelaySeconds({ dayIndex, now = new Date() }) {
	return dayIndex <= 0 ? 0 : secondsUntilNextUtcDay(now) + (dayIndex - 1) * 24 * 60 * 60;
}

// How many of `newCount` never-emailed contacts go in the first wave. 0 means no slicing: everyone goes together.
export function getSliceSize(newCount) {
	if (newCount <= NEW_CONTACT_THRESHOLD) return 0;
	return Math.min(SLICE_MAX, Math.max(SLICE_MIN, Math.ceil(newCount * SLICE_RATIO)), newCount);
}

// The order a send goes out in, and which wave each email is in. messages: [{ id, kind, isNew }] already in
// engagement order. People who have had email before go first, then the slice of new people, then last-chance
// emails; the rest of the new people are the second wave, held back.
export function arrangeWaves(messages) {
	const issues = messages.filter(({ kind }) => kind === "campaign");
	const others = messages.filter(({ kind }) => kind !== "campaign");
	const known = issues.filter(({ isNew }) => !isNew);
	const fresh = issues.filter(({ isNew }) => isNew);
	const slice = getSliceSize(fresh.length);
	const sliced = slice > 0;
	const first = sliced ? fresh.slice(0, slice) : fresh;
	const second = sliced ? fresh.slice(slice) : [];
	return {
		first: [...known, ...first, ...others],
		second,
		slice: sliced ? { size: slice, of: fresh.length } : null,
	};
}

// One QStash request per batch of `size`: each carries the delay it must wait (seconds, 0 for none).
// Positions run across both waves, so the second wave also respects the daily allowance.
export function scheduleBatches({ first, second, size, cap, sentToday, now = new Date() }) {
	const requests = [];
	let position = 0;
	for (const [list, minDelay] of [[first, 0], [second, SECOND_WAVE_DELAY_SECONDS]]) {
		for (let start = 0; start < list.length; start += size) {
			const ids = list.slice(start, start + size).map(({ id }) => id);
			const dayDelay = getDayDelaySeconds({ dayIndex: getDayIndex({ position: position + start, cap, sentToday }), now });
			requests.push({ ids, delay: Math.max(minDelay, dayDelay) });
		}
		position += list.length;
	}
	return requests;
}

// What to tell the person about a send before and after it is queued.
export function describeSendPlan({ total, cap, sentToday, slice }) {
	const lines = [];
	if (Number.isFinite(cap)) {
		const today = Math.min(total, getRemainingToday({ cap, sentToday }));
		const days = Math.ceil(Math.max(0, total - today) / cap) + (today > 0 || total === 0 ? 1 : 0);
		if (total > today) {
			lines.push(
				days > 1
					? `Your sending is still building up (${cap.toLocaleString("en-US")} emails a day), so this goes out over ${days} days: ${today.toLocaleString("en-US")} today, then the rest.`
					: ""
			);
		}
	}
	if (slice) {
		lines.push(`${slice.of.toLocaleString("en-US")} of these people have never had an email from you. The first ${slice.size.toLocaleString("en-US")} go out now; the rest follow 3 hours later if nothing looks wrong.`);
	}
	return lines.filter(Boolean);
}

// A send that reaches fewer people than the audience, because only so many can go out over the next days.
export function describeWarmupLimit({ reached, audience, cap }) {
	if (!Number.isFinite(cap) || reached >= audience) return null;
	return `This issue goes to the ${reached.toLocaleString("en-US")} most engaged of ${audience.toLocaleString("en-US")} people for now: your sending is still building up (${cap.toLocaleString("en-US")} emails a day). Use "Send to more" in a few days for the rest.`;
}
