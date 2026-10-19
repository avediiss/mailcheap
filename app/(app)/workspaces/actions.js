"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getWorkspaceContext, WORKSPACE_COOKIE } from "@/lib/workspace";

// Only a workspace the person may use can be picked, so the cookie can't be used to reach another one.
export async function switchWorkspace(workspaceId) {
	const context = await getWorkspaceContext();
	if (!context) return { error: "Sign in again" };
	if (!context.workspaces.some(({ id }) => id === workspaceId)) return { error: "Workspace not found" };

	const store = await cookies();
	store.set(WORKSPACE_COOKIE, workspaceId, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
	});
	revalidatePath("/", "layout");
	return { ok: true };
}
