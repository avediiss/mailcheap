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
	return rows.map((row) => ({ id: String(row._id), action: row.action, actorEmail: row.actorEmail ?? null, detail: row.detail ?? null, at: row.createdAt }));
}
