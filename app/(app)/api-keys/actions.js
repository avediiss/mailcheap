"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { notifyActivity } from "@/lib/alerts";
import { generateApiKey } from "@/lib/api-keys";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";
import ApiKey from "@/models/ApiKey";

export async function createApiKey(_state, formData) {
	const { workspaceId, role } = await requireWorkspace();
	if (!hasRole(role, "owner")) return { error: "Only a workspace owner can create API keys" };
	const name = String(formData.get("name") ?? "")
		.trim()
		.slice(0, 60);
	if (!name) return { error: "Name is required" };

	await connectDb();
	const { key, prefix, hash } = generateApiKey();
	await ApiKey.create({ workspaceId, name, prefix, hash });
	await notifyActivity([`API key created: ${name}`, `${getAppUrl()}/api-keys`]);

	revalidatePath("/api-keys");
	return { key };
}

export async function revokeApiKey(id) {
	const { workspaceId, role } = await requireWorkspace();
	if (!hasRole(role, "owner")) return { error: "Only a workspace owner can revoke API keys" };
	if (!isValidObjectId(id)) return { error: "Key not found" };

	await connectDb();
	// Scoped: another workspace's key id revokes nothing.
	await ApiKey.updateOne({ _id: id, workspaceId, revokedAt: null }, { $set: { revokedAt: new Date() } });

	revalidatePath("/api-keys");
	return { ok: true };
}
