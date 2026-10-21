import "server-only";
import { hashApiKey, readBearerToken, shouldTouchLastUsed } from "@/lib/api-key-tokens";
import { connectDb } from "@/lib/db";
import ApiKey from "@/models/ApiKey";
import Workspace from "@/models/Workspace";

export { generateApiKey, hashApiKey } from "@/lib/api-key-tokens";

export async function authenticateRequest(request) {
	const key = readBearerToken(request.headers.get("authorization"));
	if (!key) return null;

	await connectDb();
	const apiKey = await ApiKey.findOne({ hash: hashApiKey(key), revokedAt: null }).lean();
	// A key without a workspace (made before workspaces existed and not migrated) reaches nothing.
	if (!apiKey?.workspaceId) return null;
	const workspace = await Workspace.findById(apiKey.workspaceId).select({ status: 1 }).lean();
	if (!workspace) return null;

	const now = new Date();
	if (shouldTouchLastUsed(apiKey.lastUsedAt, now.getTime())) {
		await ApiKey.updateOne({ _id: apiKey._id }, { $set: { lastUsedAt: now } }).catch((error) =>
			console.error("[api-keys] Could not update lastUsedAt:", error.message)
		);
	}
	// The key belongs to one workspace: routes only look up newsletters inside apiKey.workspaceId.
	return { ...apiKey, isWorkspaceActive: workspace.status === "active" };
}
