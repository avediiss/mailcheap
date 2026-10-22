import { shiftDateKey } from "./time-zone.js";

// Pure rules for the platform console's graphs and forecasts. Days are UTC dates (YYYY-MM-DD): the console
// looks at every client at once, so no one person's time zone applies.

export const RANGE_OPTIONS = [7, 30, 90];
export const DEFAULT_RANGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const OTHERS_ID = "others";
export const MIN_SENT_FOR_RATE = 20;
export const MIN_DAYS_FOR_PROJECTION = 3;
export const QUIET_DAYS = 30;
const NEW_WORKSPACE_DAYS = 7;

export function parseRange(value) {
	const days = Number.parseInt(value, 10);
	return RANGE_OPTIONS.includes(days) ? days : DEFAULT_RANGE;
}

export function utcDateKey(date) {
	return new Date(date).toISOString().slice(0, 10);
}

// The last `days` dates, oldest first, ending with today.
export function rangeDayKeys(todayKey, days) {
	return Array.from({ length: days }, (_, index) => shiftDateKey(todayKey, index - days + 1));
}

export function rate(part, total) {
	return total ? part / total : null;
}

const COUNT_KEYS = ["sent", "delivered", "opened", "clicked", "bounced", "complained"];
const emptyCounts = () => Object.fromEntries(COUNT_KEYS.map((key) => [key, 0]));

// rows: [{ day, workspaceId, sent, delivered, opened, clicked, bounced, complained }] grouped by the day the
// email was sent (a bounce counts on the day of the email that bounced). Days with no rows are zeros.
export function buildSendSeries({ dayKeys, rows }) {
	const days = dayKeys.map((key) => ({ key, ...emptyCounts(), byWorkspace: {} }));
	const index = new Map(days.map((day, position) => [day.key, position]));
	const totals = emptyCounts();
	const perWorkspace = {};

	for (const row of rows) {
		const position = index.get(row.day);
		if (position === undefined) continue;
		const id = String(row.workspaceId);
		const day = days[position];
		const workspace = (perWorkspace[id] ??= { ...emptyCounts(), daily: Array(dayKeys.length).fill(0) });
		for (const key of COUNT_KEYS) {
			const count = row[key] ?? 0;
			day[key] += count;
			totals[key] += count;
			workspace[key] += count;
		}
		day.byWorkspace[id] = (day.byWorkspace[id] ?? 0) + (row.sent ?? 0);
		workspace.daily[position] += row.sent ?? 0;
	}
	return { days, totals, perWorkspace };
}

// Which workspaces get their own colour in a stacked chart: the biggest few, the rest together as "Others".
export function stackSeries({ days, perWorkspace, names, top = 5 }) {
	const ranked = Object.entries(perWorkspace)
		.filter(([, { sent }]) => sent > 0)
		.sort((a, b) => b[1].sent - a[1].sent || String(names.get(a[0])).localeCompare(String(names.get(b[0]))));
	const shown = ranked.slice(0, top).map(([id]) => id);
	const hasOthers = ranked.length > shown.length;
	const series = [...shown.map((id) => ({ id, name: names.get(id) ?? "Unknown" })), ...(hasOthers ? [{ id: OTHERS_ID, name: "Others" }] : [])];
	const stacked = days.map((day) => {
		const parts = shown.map((id) => day.byWorkspace[id] ?? 0);
		if (hasOthers) {
			const shownTotal = parts.reduce((sum, count) => sum + count, 0);
			parts.push(day.sent - shownTotal);
		}
		return { key: day.key, total: day.sent, parts };
	});
	return { series, days: stacked };
}

// A smoothed rate per day: the numerator over the sends of the trailing window, so one unlucky day of a
// handful of emails doesn't swing the line. Null while the window holds too few sends to mean anything.
export function rollingRate(days, field, { window = 7, minSent = MIN_SENT_FOR_RATE } = {}) {
	return days.map((_, position) => {
		const slice = days.slice(Math.max(0, position - window + 1), position + 1);
		const sent = slice.reduce((sum, day) => sum + day.sent, 0);
		if (sent < minSent) return null;
		return slice.reduce((sum, day) => sum + day[field], 0) / sent;
	});
}

// Where this month's sending is heading at its current pace. Early in the month a pace means little, so the
// result says when it isn't reliable.
export function projectMonthEnd({ used, now = new Date() }) {
	const current = new Date(now);
	const start = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1);
	const daysInMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
	const elapsedDays = Math.max((current.getTime() - start) / DAY_MS, 1 / 24);
	const projected = Math.round((Math.max(0, used) / elapsedDays) * daysInMonth);
	return { projected: Math.max(projected, used), elapsedDays, daysInMonth, isReliable: elapsedDays >= MIN_DAYS_FOR_PROJECTION && used > 0 };
}

// "over": on pace to pass a limit it hasn't reached yet. "reached" and "ok" are for completeness.
export function getProjectionState({ used, limit, now }) {
	if (limit === null || limit === undefined) return { state: "none" };
	const projection = projectMonthEnd({ used, now });
	if (used >= limit) return { state: "reached", ...projection };
	if (projection.isReliable && projection.projected > limit) return { state: "over", ...projection };
	return { state: "ok", ...projection };
}

// Active workspaces that haven't sent for a while, or never did although they have existed for a week.
export function findQuietWorkspaces({ workspaces, lastSentBy, now = new Date(), days = QUIET_DAYS }) {
	const current = new Date(now).getTime();
	return workspaces
		.filter(({ status }) => status === "active")
		.map(({ id, name, createdAt }) => {
			const last = lastSentBy.get(id) ?? null;
			const idleDays = last ? Math.floor((current - new Date(last).getTime()) / DAY_MS) : null;
			const age = (current - new Date(createdAt).getTime()) / DAY_MS;
			return { id, name, lastSentAt: last, idleDays, isQuiet: last ? idleDays >= days : age >= NEW_WORKSPACE_DAYS };
		})
		.filter(({ isQuiet }) => isQuiet)
		.sort((a, b) => (b.idleDays ?? Number.POSITIVE_INFINITY) - (a.idleDays ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name));
}

export function formatIdle(idleDays) {
	return idleDays === null ? "Never sent" : `No send in ${idleDays} days`;
}
