import "server-only";
import { connectDb } from "@/lib/db";
import ContactField from "@/models/ContactField";

// A workspace's fields in the order they were made.
export async function listContactFields(workspaceId) {
	await connectDb();
	const rows = await ContactField.find({ workspaceId }).sort({ createdAt: 1, key: 1 }).select({ key: 1, label: 1, type: 1 }).lean();
	return rows.map(({ key, label, type }) => ({ key, label, type }));
}

// For a batch of emails: each workspace's field keys, loaded once. A key being defined is what lets a tag with no
// value for this contact print its fallback instead of staying as written.
export async function loadFieldKeys(workspaceIds) {
	const ids = [...new Set([...workspaceIds].map(String))];
	if (ids.length === 0) return new Map();
	await connectDb();
	const rows = await ContactField.find({ workspaceId: { $in: ids } }).select({ workspaceId: 1, key: 1 }).lean();
	const byWorkspace = new Map(ids.map((id) => [id, []]));
	for (const { workspaceId, key } of rows) byWorkspace.get(String(workspaceId)).push(key);
	return byWorkspace;
}
