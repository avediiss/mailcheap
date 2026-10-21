"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, startSession } from "@/lib/auth";
import { acceptInvitationExistingUser, acceptInvitationNewUser } from "@/lib/members";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { WORKSPACE_COOKIE } from "@/lib/workspace";

const ATTEMPTS_PER_IP = { name: "invite-ip", limit: 10, window: "15 m" };

async function rememberWorkspace(workspaceId) {
	const store = await cookies();
	store.set(WORKSPACE_COOKIE, workspaceId, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
	});
}

// Someone new: the invitation's address plus the name and password they choose make their account, and they're in.
export async function acceptInvitation(_state, formData) {
	if (await isRateLimited({ ...ATTEMPTS_PER_IP, key: getClientIp(await headers()) })) {
		return { error: "Too many attempts. Try again later." };
	}
	const password = String(formData.get("password") ?? "");
	if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords don't match." };

	const result = await acceptInvitationNewUser({
		token: String(formData.get("token") ?? ""),
		name: formData.get("name"),
		password,
	});
	if (result.error) return result;
	await startSession(result.user);
	await rememberWorkspace(result.workspaceId);
	redirect("/");
}

// Someone who already has an account and is logged in as the invited address.
export async function joinWorkspace(_state, formData) {
	const session = await getSession();
	if (!session) return { error: "Log in first" };
	const result = await acceptInvitationExistingUser({ token: String(formData.get("token") ?? ""), session });
	if (result.error) return result;
	await rememberWorkspace(result.workspaceId);
	redirect("/");
}
