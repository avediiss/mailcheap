"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { notifyActivity } from "@/lib/alerts";
import { changeMemberRole, inviteMember, removeMember, renewInvitation, revokeInvitation } from "@/lib/members";
import { isRateLimited } from "@/lib/rate-limit";
import { requireWorkspace } from "@/lib/workspace";
import { hasRole } from "@/lib/workspace-rules";

const INVITES_PER_HOUR = { name: "invites-workspace", limit: 30, window: "1 h" };

// Members are managed by the workspace's owners. Everything below checks it again: a button being hidden
// is not a permission.
async function requireOwner() {
	const context = await requireWorkspace();
	if (!hasRole(context.role, "owner")) return { error: "Only a workspace owner can manage members" };
	if (context.isSuspended) return { error: "This workspace is suspended" };
	return { context };
}

export async function inviteToWorkspace(_state, formData) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (await isRateLimited({ ...INVITES_PER_HOUR, key: String(context.workspaceId) })) {
		return { error: "Too many invitations in the last hour. Try again later." };
	}

	const result = await inviteMember({
		workspaceId: context.workspaceId,
		inviter: context.session,
		email: String(formData.get("email") ?? ""),
		role: String(formData.get("role") ?? "editor"),
	});
	if (result.ok) {
		await notifyActivity([`Invited ${formData.get("email")} to ${context.workspace.name}`]);
		revalidatePath("/members");
	}
	return result;
}

export async function resendInvitation(invitationId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(invitationId)) return { error: "Invitation not found" };
	const result = await renewInvitation({ workspaceId: context.workspaceId, invitationId, inviter: context.session, sendEmail: true });
	revalidatePath("/members");
	return result;
}

// For sharing the invitation yourself: a new link, and the old one stops working.
export async function getInvitationLink(invitationId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(invitationId)) return { error: "Invitation not found" };
	return renewInvitation({ workspaceId: context.workspaceId, invitationId, inviter: context.session, sendEmail: false });
}

export async function revokeWorkspaceInvitation(invitationId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(invitationId)) return { error: "Invitation not found" };
	const result = await revokeInvitation({ workspaceId: context.workspaceId, invitationId });
	revalidatePath("/members");
	return result;
}

export async function setMemberRole(userId, role) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(userId)) return { error: "This person is not in the workspace" };
	const result = await changeMemberRole({ workspaceId: context.workspaceId, userId, role });
	revalidatePath("/members");
	return result;
}

export async function removeWorkspaceMember(userId) {
	const { context, error } = await requireOwner();
	if (error) return { error };
	if (!isValidObjectId(userId)) return { error: "This person is not in the workspace" };
	const result = await removeMember({ workspaceId: context.workspaceId, userId });
	if (result.ok) await notifyActivity([`Removed a member from ${context.workspace.name}`]);
	revalidatePath("/members");
	return result;
}
