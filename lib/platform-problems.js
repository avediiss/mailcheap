import "server-only";
import { connectDb } from "@/lib/db";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const STALLED_AFTER_HOURS = 1;
export const FAILED_WINDOW_DAYS = 7;

// What isn't going out the way it should, across every workspace: sends a workspace paused (or the platform
// did, at the limit), sends that stopped making progress, and emails that failed. Newest first.
export async function listSendingProblems({ now = new Date(), limit = 12 } = {}) {
	await connectDb();
	const stalledBefore = new Date(now.getTime() - STALLED_AFTER_HOURS * HOUR_MS);
	const failedSince = new Date(now.getTime() - FAILED_WINDOW_DAYS * DAY_MS);

	const [paused, stalled, failed] = await Promise.all([
		Campaign.find({ status: "paused" }).select({ workspaceId: 1, subject: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(limit).lean(),
		Campaign.find({ status: "sending", updatedAt: { $lt: stalledBefore } }).select({ workspaceId: 1, subject: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(limit).lean(),
		Message.aggregate([
			{ $match: { status: "failed", updatedAt: { $gte: failedSince } } },
			{ $group: { _id: "$workspaceId", count: { $sum: 1 }, last: { $max: "$updatedAt" }, error: { $last: "$error" } } },
			{ $sort: { last: -1 } },
			{ $limit: limit },
		]),
	]);

	const campaignProblem = (kind, title) => (row) => ({ kind, workspaceId: String(row.workspaceId), title, detail: row.subject || "(no subject)", at: row.updatedAt });
	return [
		...paused.map(campaignProblem("paused", "Send paused")),
		...stalled.map(campaignProblem("stalled", "Send stopped making progress")),
		...failed.map((row) => ({
			kind: "failed",
			workspaceId: String(row._id),
			title: `${row.count.toLocaleString("en-US")} ${row.count === 1 ? "email" : "emails"} failed in ${FAILED_WINDOW_DAYS} days`,
			detail: row.error ? String(row.error).slice(0, 140) : "No reason recorded",
			at: row.last,
		})),
	]
		.sort((a, b) => new Date(b.at) - new Date(a.at))
		.slice(0, limit);
}
