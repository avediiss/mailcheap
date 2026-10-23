import "server-only";
import { cache } from "react";
import { Types } from "mongoose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { isWorkspaceActive, pickActiveWorkspace } from "@/lib/workspace-rules";
import Domain from "@/models/Domain";
import Membership from "@/models/Membership";
import Workspace from "@/models/Workspace";

// Which workspace the person last picked. Only a hint: it is checked against what they may use on every request.
export const WORKSPACE_COOKIE = "mailcheap_workspace";

function toEntry(workspace, role) {
	return { id: String(workspace._id), name: workspace.name, slug: workspace.slug, status: workspace.status, blockReason: workspace.blockReason ?? "", role };
}

// The workspaces this person belongs to, with their role in each. Being the platform owner changes nothing here:
// the platform owner controls and checks workspaces from the console, but can't read inside one they weren't
// invited to. An account that only runs the platform has no workspace at all.
async function listWorkspaces(session) {
	const memberships = await Membership.find({ userId: session.userId }).lean();
	if (memberships.length === 0) return [];
	const workspaces = await Workspace.find({ _id: { $in: memberships.map(({ workspaceId }) => workspaceId) } })
		.sort({ createdAt: 1 })
		.lean();
	const roles = new Map(memberships.map(({ workspaceId, role }) => [String(workspaceId), role]));
	return workspaces.map((workspace) => toEntry(workspace, roles.get(String(workspace._id))));
}

// null when nobody is signed in. Once per request, however many pages and actions ask.
export const getWorkspaceContext = cache(async () => {
	const session = await getSession();
	if (!session) return null;
	await connectDb();
	const workspaces = await listWorkspaces(session);
	const store = await cookies();
	const active = pickActiveWorkspace(workspaces, store.get(WORKSPACE_COOKIE)?.value);
	return {
		session,
		workspaces,
		workspace: active,
		// An ObjectId, not a string: aggregate() and $lookup don't cast, and a string there matches nothing.
		workspaceId: active ? new Types.ObjectId(active.id) : null,
		role: active?.role ?? null,
		isSuspended: active ? !isWorkspaceActive(active) : false,
	};
});

// For pages and server actions: someone is signed in and has a workspace. Every query that follows
// filters by the returned workspaceId, and an id from the browser is only trusted once it is found with it.
export async function requireWorkspace() {
	const context = await getWorkspaceContext();
	if (!context) redirect("/login");
	// An account that only runs the platform has no newsletters to show: its home is the console.
	if (!context.workspace) redirect(context.session.isPlatformAdmin ? "/platform" : "/no-workspace");
	return context;
}

// The domains this workspace may send from (lib/workspace-rules.js isSenderAllowed).
export async function listWorkspaceDomains(workspaceId) {
	const rows = await Domain.find({ workspaceId }).select({ domain: 1 }).lean();
	return rows.map(({ domain }) => domain);
}
