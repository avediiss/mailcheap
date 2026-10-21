"use server";

import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { notifyActivity } from "@/lib/alerts";
import { addWorkspaceDomain, removeWorkspaceDomain, setUpWorkspaceDomain } from "@/lib/domains";
import { isRateLimited } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";

const ADDS_PER_HOUR = { name: "domains-workspace", limit: 10, window: "1 h" };

async function requireOwner() {
	const context = await requireWorkspace();
	if (!hasRole(context.role, "owner")) return { error: "Only a workspace owner can manage domains" };
	if (context.isSuspended) return { error: "This workspace is suspended" };
	return { context };
}

export async function addDomain(_state, formData) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (await isRateLimited({ ...ADDS_PER_HOUR, key: String(context.workspaceId) })) {
		return { error: "Too many domains added in the last hour. Try again later." };
	}
	const result = await addWorkspaceDomain({
		workspaceId: context.workspaceId,
		userId: context.session.userId,
		input: String(formData.get("domain") ?? ""),
		isPlatformAdmin: context.session.isPlatformAdmin,
	});
	if (result.ok) {
		await notifyActivity([`Domain added: ${result.domain} (${context.workspace.name})`]);
		revalidatePath("/domains");
	}
	return result;
}

export async function removeDomain(domainId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(domainId)) return { error: "Domain not found" };
	const result = await removeWorkspaceDomain({ workspaceId: context.workspaceId, domainId });
	if (result.ok) revalidatePath("/domains");
	return result;
}

export async function setUpDomain(domainId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(domainId)) return { error: "Domain not found" };
	const result = await setUpWorkspaceDomain({ workspaceId: context.workspaceId, domainId });
	if (result.ok) revalidatePath("/domains");
	return result;
}

// Asks SES again, ignoring its short cache: for the "Check again" button after the DNS records are in.
export async function refreshDomains() {
	await requireWorkspace();
	revalidatePath("/domains");
	return { ok: true };
}
