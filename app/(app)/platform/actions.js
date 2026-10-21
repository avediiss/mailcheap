"use server";

import { isValidObjectId } from "mongoose";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { inviteMember } from "@/lib/members";
import { readLimits, slugifyWorkspaceName } from "@/lib/platform-rules";
import { WORKSPACE_COOKIE } from "@/lib/workspace";
import { normalizeEmail } from "@/lib/validation";
import Workspace from "@/models/Workspace";

const MAX_NAME_LENGTH = 80;

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

function readLimitInput(formData) {
	return { contacts: formData.get("contacts"), emailsPerMonth: formData.get("emailsPerMonth"), newsletters: formData.get("newsletters") };
}

// A slug nobody has: "acme", then "acme-2", "acme-3"...
async function findFreeSlug(name) {
	const base = slugifyWorkspaceName(name) || "workspace";
	for (let attempt = 1; attempt < 50; attempt++) {
		const slug = attempt === 1 ? base : `${base.slice(0, 36)}-${attempt}`;
		if (!(await Workspace.exists({ slug }))) return slug;
	}
	return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

// A new client: the workspace, its limits, and an invitation to its first owner.
export async function createWorkspace(_state, formData) {
	const session = await requirePlatformAdmin();
	const name = readText(formData, "name");
	if (name.length < 2 || name.length > MAX_NAME_LENGTH) return { error: `Give the workspace a name of 2 to ${MAX_NAME_LENGTH} characters` };
	const ownerEmail = normalizeEmail(readText(formData, "ownerEmail"));
	if (!ownerEmail) return { error: "Enter the first owner's email address" };
	const { limits, error } = readLimits(readLimitInput(formData));
	if (error) return { error };

	await connectDb();
	const workspace = await Workspace.create({ name, slug: await findFreeSlug(name), limits });
	await recordAudit({ actor: session, workspaceId: workspace._id, action: "workspace.created", detail: { name, limits, ownerEmail } });

	const invitation = await inviteMember({ workspaceId: workspace._id, inviter: session, email: ownerEmail, role: "owner" });
	revalidatePath("/platform", "layout");
	return {
		ok: true,
		workspaceId: String(workspace._id),
		name,
		// The workspace exists either way; if the invitation couldn't be made, say so and give what there is.
		invitationError: invitation.error ?? null,
		link: invitation.link ?? null,
		emailed: Boolean(invitation.emailed),
		reason: invitation.reason ?? null,
	};
}

export async function updateWorkspace(_state, formData) {
	const session = await requirePlatformAdmin();
	const id = readText(formData, "id");
	if (!isValidObjectId(id)) return { error: "Workspace not found" };
	const name = readText(formData, "name");
	if (name.length < 2 || name.length > MAX_NAME_LENGTH) return { error: `Give the workspace a name of 2 to ${MAX_NAME_LENGTH} characters` };
	const { limits, error } = readLimits(readLimitInput(formData));
	if (error) return { error };

	await connectDb();
	const before = await Workspace.findById(id).select({ name: 1, limits: 1 }).lean();
	if (!before) return { error: "Workspace not found" };
	await Workspace.updateOne({ _id: id }, { $set: { name, limits } });
	if (before.name !== name) await recordAudit({ actor: session, workspaceId: id, action: "workspace.renamed", detail: { from: before.name, to: name } });
	if (JSON.stringify(before.limits ?? {}) !== JSON.stringify(limits)) {
		await recordAudit({ actor: session, workspaceId: id, action: "workspace.limits", detail: { limits } });
	}
	revalidatePath("/platform", "layout");
	return { ok: true };
}

// Suspending stops sending, signups and the API for the workspace; its people can still log in and look.
export async function setWorkspaceStatus(id, status) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(id) || !["active", "suspended"].includes(status)) return { error: "Workspace not found" };
	await connectDb();
	const { matchedCount } = await Workspace.updateOne({ _id: id }, { $set: { status } });
	if (!matchedCount) return { error: "Workspace not found" };
	await recordAudit({ actor: session, workspaceId: id, action: status === "suspended" ? "workspace.suspended" : "workspace.resumed" });
	revalidatePath("/", "layout");
	return { ok: true };
}

// Steps into a workspace to look at what its people see. Recorded, because it is the platform owner acting
// inside someone else's space.
export async function openWorkspace(id) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(id)) return { error: "Workspace not found" };
	await connectDb();
	const workspace = await Workspace.findById(id).select({ name: 1 }).lean();
	if (!workspace) return { error: "Workspace not found" };

	const store = await cookies();
	store.set(WORKSPACE_COOKIE, String(id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
	await recordAudit({ actor: session, workspaceId: id, action: "workspace.opened", detail: { name: workspace.name } });
	redirect("/");
}
