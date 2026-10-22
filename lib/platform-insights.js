import "server-only";
import mongoose from "mongoose";
import { connectDb } from "@/lib/db";
import { IMPORT_WINDOW_MS, LEFT_STATUSES, dayOf, joinedDay } from "@/lib/overview-data";
import { buildSubscriberSeries } from "@/lib/overview-series";
import { buildSendSeries, rangeDayKeys, stackSeries, utcDateKey } from "@/lib/platform-series";
import { startOfDateKey } from "@/lib/time-zone";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

const UTC = "UTC";

// What the platform overview draws: sends per day (by workspace), the rates behind them, and subscribers
// joining and leaving, for the last `range` days across every workspace. UTC days, in one pass each.
export async function getPlatformInsights({ range, names, workspaceId, now = new Date() }) {
	await connectDb();
	// One workspace's own numbers, or everyone's.
	const scope = workspaceId ? { workspaceId: new mongoose.Types.ObjectId(String(workspaceId)) } : {};
	const dayKeys = rangeDayKeys(utcDateKey(now), range);
	const rangeStart = startOfDateKey(dayKeys[0], UTC);

	const [sendRows, activeBefore, joinRows, leaveRows] = await Promise.all([
		Message.aggregate([
			{ $match: { ...scope, sentAt: { $gte: rangeStart }, kind: { $ne: "test" } } },
			{
				$group: {
					_id: { day: dayOf("$sentAt", UTC), workspaceId: "$workspaceId" },
					sent: { $sum: 1 },
					delivered: { $sum: { $cond: [{ $gt: ["$deliveredAt", null] }, 1, 0] } },
					opened: { $sum: { $cond: [{ $gt: ["$openedAt", null] }, 1, 0] } },
					clicked: { $sum: { $cond: [{ $gt: ["$clickedAt", null] }, 1, 0] } },
					bounced: { $sum: { $cond: [{ $gt: ["$bouncedAt", null] }, 1, 0] } },
					complained: { $sum: { $cond: [{ $gt: ["$complainedAt", null] }, 1, 0] } },
				},
			},
		]),
		Contact.countDocuments({ ...scope, status: "active", subscribedAt: { $lt: rangeStart } }),
		Contact.aggregate([
			{ $match: { ...scope, status: "active", subscribedAt: { $gte: rangeStart } } },
			{ $group: { _id: { workspaceId: "$workspaceId", day: joinedDay(rangeStart, UTC) }, count: { $sum: 1 } } },
		]),
		Contact.aggregate([
			{
				$match: {
					...scope,
					status: { $in: LEFT_STATUSES },
					unsubscribedAt: { $gte: rangeStart },
					$expr: { $gt: ["$unsubscribedAt", { $add: ["$createdAt", IMPORT_WINDOW_MS] }] },
				},
			},
			{
				$group: {
					_id: { workspaceId: "$workspaceId", joined: joinedDay(rangeStart, UTC), left: dayOf("$unsubscribedAt", UTC) },
					count: { $sum: 1 },
				},
			},
		]),
	]);

	const send = buildSendSeries({ dayKeys, rows: sendRows.map(({ _id, ...counts }) => ({ ...counts, ...(_id) })) });
	const stack = stackSeries({ days: send.days, perWorkspace: send.perWorkspace, names });

	// Subscribers: joins and leaves per day, and per workspace for "who is growing". Someone who joined before the
	// range and left inside it was in the starting count.
	let baseline = activeBefore;
	const joins = {};
	const leaves = {};
	const growthBy = new Map();
	const grow = (id, delta) => growthBy.set(id, (growthBy.get(id) ?? 0) + delta);
	for (const { _id, count } of joinRows) {
		if (_id.day) joins[_id.day] = (joins[_id.day] ?? 0) + count;
		else baseline += count;
		grow(String(_id.workspaceId), count);
	}
	for (const { _id, count } of leaveRows) {
		if (_id.joined) joins[_id.joined] = (joins[_id.joined] ?? 0) + count;
		else baseline += count;
		leaves[_id.left] = (leaves[_id.left] ?? 0) + count;
		// Joined in the range and left in it: no net change for that workspace.
		if (!_id.joined) grow(String(_id.workspaceId), -count);
	}
	const { start, days } = buildSubscriberSeries({ dayKeys, baseline, joins, leaves });
	const subscribers = {
		start,
		days,
		total: days.at(-1)?.total ?? start,
		joined: days.reduce((sum, day) => sum + day.joined, 0),
		left: days.reduce((sum, day) => sum + day.left, 0),
	};

	return { range, dayKeys, send, stack, subscribers, growthBy };
}
