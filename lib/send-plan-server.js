import "server-only";
import { connectDb } from "@/lib/db";
import { getHealth } from "@/lib/platform-rules";
import { getDailySendCap, getWarmupDay, startOfUtcDay } from "@/lib/send-plan";
import { getHealthTotals } from "@/lib/workspace-health-server";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Workspace from "@/models/Workspace";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 90;
const CACHE_TTL_MS = 10 * 60_000;
const ID_CHUNK = 5000;
const largestDayCache = new Map();

export function clearSendPlanCache() {
	largestDayCache.clear();
}

// The busiest day (before today) in the last 90 days, test emails aside. Cached: a batch asks every few seconds.
async function getLargestRecentDay(workspaceId, now) {
	const key = String(workspaceId);
	const hit = largestDayCache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
	const rows = await Message.aggregate([
		{ $match: { workspaceId, kind: { $ne: "test" }, sentAt: { $gte: new Date(startOfUtcDay(now).getTime() - RECENT_DAYS * DAY_MS), $lt: startOfUtcDay(now) } } },
		{ $group: { _id: { $dateToString: { date: "$sentAt", format: "%Y-%m-%d", timezone: "UTC" } }, count: { $sum: 1 } } },
		{ $group: { _id: null, largest: { $max: "$count" } } },
	]);
	const value = rows[0]?.largest ?? 0;
	largestDayCache.set(key, { at: Date.now(), value });
	return value;
}

// Everything the daily allowance depends on, for one workspace: when it started sending, what it has sent today,
// its busiest recent day, whether its numbers are already borderline, and what the platform has set for it.
export async function loadSendState(workspaceId, { now = new Date() } = {}) {
	await connectDb();
	const workspace = await Workspace.findById(workspaceId).select({ sendingTrust: 1, healthResetAt: 1 }).lean();
	const [first, sentToday, largestRecentDay, totals] = await Promise.all([
		Message.findOne({ workspaceId, kind: { $ne: "test" }, sentAt: { $gt: new Date(0) } }).sort({ sentAt: 1 }).select({ sentAt: 1 }).lean(),
		Message.countDocuments({ workspaceId, kind: { $ne: "test" }, sentAt: { $gte: startOfUtcDay(now) } }),
		getLargestRecentDay(workspaceId, now),
		getHealthTotals({ workspaceId, healthResetAt: workspace?.healthResetAt, now }),
	]);
	const health = getHealth(totals);
	const trust = workspace?.sendingTrust ?? {};
	const firstSentAt = first?.sentAt ?? null;
	const isWatch = health === "watch" || health === "bad";
	return {
		firstSentAt,
		sentToday,
		largestRecentDay,
		isWatch,
		isTrusted: Boolean(trust.isTrusted),
		warmupDay: getWarmupDay({ firstSentAt, now }),
		cap: getDailySendCap({ firstSentAt, now, largestRecentDay, isTrusted: Boolean(trust.isTrusted), capOverride: trust.dailyCap ?? null, isWatch }),
	};
}

// Of these contact ids, the ones who have never had an email from their workspace.
export async function findNeverEmailed(contactIds) {
	const unique = [...new Set(contactIds.filter(Boolean).map(String))];
	const never = new Set();
	for (let start = 0; start < unique.length; start += ID_CHUNK) {
		const ids = await Contact.distinct("_id", { _id: { $in: unique.slice(start, start + ID_CHUNK) }, lastSentAt: null });
		for (const id of ids) never.add(String(id));
	}
	return never;
}
