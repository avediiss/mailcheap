import "server-only";
import { sendAlert } from "@/lib/alerts";
import { recordAudit } from "@/lib/audit";
import { connectDb } from "@/lib/db";
import { getAccountBlockReason, getHealthWindowStart } from "@/lib/workspace-health";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";
import Workspace from "@/models/Workspace";

const CHECK_EVERY_MS = 60_000;
const lastChecked = new Map();

// What a workspace sent over the health window, and how much of it bounced or drew a complaint. Tests don't count.
export async function getHealthTotals({ workspaceId, healthResetAt, now = new Date() }) {
	const since = getHealthWindowStart({ now, healthResetAt });
	const [row] = await Message.aggregate([
		{ $match: { workspaceId, sentAt: { $gte: since }, kind: { $ne: "test" } } },
		{
			$group: {
				_id: null,
				sent: { $sum: 1 },
				bounced: { $sum: { $cond: [{ $gt: ["$bouncedAt", null] }, 1, 0] } },
				complained: { $sum: { $cond: [{ $gt: ["$complainedAt", null] }, 1, 0] } },
			},
		},
	]);
	return { sent: row?.sent ?? 0, bounced: row?.bounced ?? 0, complained: row?.complained ?? 0 };
}

// Blocks the workspace when its last 7 days are past the limits: nothing sends, signups and the API stop, running
// sends pause, and the owners and the platform are told why. Cheap enough to call often; `force` skips the
// once-a-minute throttle. Returns the reason when it blocked, else null.
export async function evaluateWorkspaceHealth(workspaceId, { now = new Date(), force = false } = {}) {
	const key = String(workspaceId);
	if (!force && Date.now() - (lastChecked.get(key) ?? 0) < CHECK_EVERY_MS) return null;
	lastChecked.set(key, Date.now());

	await connectDb();
	const workspace = await Workspace.findById(workspaceId).select({ status: 1, healthResetAt: 1, name: 1 }).lean();
	if (!workspace || workspace.status !== "active") return null;
	const reason = getAccountBlockReason(await getHealthTotals({ workspaceId: workspace._id, healthResetAt: workspace.healthResetAt, now }));
	if (!reason) return null;

	// Only the check that flips it announces it.
	const { modifiedCount } = await Workspace.updateOne(
		{ _id: workspace._id, status: "active" },
		{ $set: { status: "suspended", blockedAt: new Date(), blockReason: reason } }
	);
	if (!modifiedCount) return null;
	await Campaign.updateMany({ workspaceId: workspace._id, status: "sending" }, { $set: { status: "paused" } });
	await recordAudit({ workspaceId: workspace._id, action: "workspace.blocked", detail: { reason } });
	await sendAlert({
		audience: "owners+platform",
		workspaceId: workspace._id,
		key: `workspace-blocked-${workspace._id}`,
		title: "Sending blocked",
		detail: `${workspace.name} was blocked: ${reason}. Nothing sends until the platform team reviews it.`,
		path: "/",
		cooldownMinutes: 1,
	});
	return reason;
}

export function clearHealthThrottle() {
	lastChecked.clear();
}
