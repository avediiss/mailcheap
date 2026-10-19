import "server-only";
import { connectDb } from "@/lib/db";
import Membership from "@/models/Membership";
import User from "@/models/User";

// The email addresses of a workspace's owners who can still log in.
export async function listOwnerEmails(workspaceId) {
	if (!workspaceId) return [];
	await connectDb();
	const memberships = await Membership.find({ workspaceId, role: "owner" }).select({ userId: 1 }).lean();
	if (memberships.length === 0) return [];
	const users = await User.find({ _id: { $in: memberships.map(({ userId }) => userId) }, disabledAt: null })
		.select({ email: 1 })
		.lean();
	return users.map(({ email }) => email);
}
