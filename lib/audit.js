import "server-only";
import { connectDb } from "@/lib/db";
import AuditLog from "@/models/AuditLog";

// Never throws: a failing log line must not undo or block the action it describes.
export async function recordAudit({ actor, workspaceId, action, detail }) {
	try {
		await connectDb();
		await AuditLog.create({ actorId: actor?.userId, actorEmail: actor?.email, workspaceId, action, detail });
	} catch (error) {
		console.error("[audit] Could not record:", error.message);
	}
}

export async function listAudit({ workspaceId, limit = 20 }) {
	await connectDb();
	const rows = await AuditLog.find(workspaceId ? { workspaceId } : {}).sort({ createdAt: -1 }).limit(limit).lean();
	return rows.map((row) => ({ id: String(row._id), workspaceId: row.workspaceId ? String(row.workspaceId) : null, action: row.action, actorEmail: row.actorEmail ?? null, detail: row.detail ?? null, at: row.createdAt }));
}

export const AUDIT_PAGE_SIZE = 50;

// One page of the log, newest first, for the full activity page: optionally one workspace and/or one kind of
// action. `before` (an ISO date from the previous page's nextBefore) continues where it stopped.
export async function listAuditPage({ workspaceId, action, before, limit = AUDIT_PAGE_SIZE } = {}) {
	await connectDb();
	const filter = {};
	if (workspaceId) filter.workspaceId = workspaceId;
	if (action) filter.action = action;
	const cutoff = before ? new Date(before) : null;
	if (cutoff && !Number.isNaN(cutoff.getTime())) filter.createdAt = { $lt: cutoff };
	const rows = await AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
	const page = rows.slice(0, limit);
	return {
		entries: page.map((row) => ({ id: String(row._id), workspaceId: row.workspaceId ? String(row.workspaceId) : null, action: row.action, actorEmail: row.actorEmail ?? null, detail: row.detail ?? null, at: row.createdAt })),
		nextBefore: rows.length > limit ? page.at(-1).createdAt.toISOString() : null,
	};
}
