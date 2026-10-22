import "server-only";
import { recordAudit } from "@/lib/audit";
import { connectDb } from "@/lib/db";
import { getAppUrl } from "@/lib/config";
import { sendInvitationEmail } from "@/lib/members";
import { createInviteToken, getInviteExpiry, getInviteState } from "@/lib/invitation-rules";
import { getAdminRemovalProblem } from "@/lib/platform-rules";
import { normalizeEmail } from "@/lib/validation";
import Invitation from "@/models/Invitation";
import User from "@/models/User";

const inviteUrl = (token) => `${getAppUrl()}/invite/${token}`;

export async function listPlatformAdmins() {
	await connectDb();
	const users = await User.find({ isPlatformAdmin: true, disabledAt: null }).sort({ createdAt: 1 }).select({ email: 1, name: 1, lastLoginAt: 1 }).lean();
	return users.map((user) => ({ userId: String(user._id), email: user.email, name: user.name ?? "", lastLoginAt: user.lastLoginAt ?? null }));
}

// Who gets platform-level alerts and emails: every administrator. ADMIN_EMAIL stays as the fallback for an
// install that has none yet.
export async function listPlatformAdminEmails() {
	const admins = await listPlatformAdmins();
	const emails = admins.map(({ email }) => email);
	if (emails.length === 0 && process.env.ADMIN_EMAIL) emails.push(process.env.ADMIN_EMAIL.trim().toLowerCase());
	return emails;
}

export async function listPlatformInvitations() {
	await connectDb();
	const rows = await Invitation.find({ platformAdmin: true, status: "pending" }).sort({ createdAt: -1 }).lean();
	return rows.map((row) => ({ id: String(row._id), email: row.email, expiresAt: row.expiresAt, isExpired: getInviteState(row) === "expired" }));
}

// Invites someone to run the platform. They get no workspace: it is an administrator-only account.
export async function invitePlatformAdmin({ inviter, email }) {
	const normalized = normalizeEmail(email);
	if (!normalized) return { error: "Enter a valid email address" };
	await connectDb();
	if (await User.exists({ email: normalized, isPlatformAdmin: true })) return { error: `${normalized} is already a platform administrator` };

	const { token, tokenHash } = createInviteToken();
	const invitation = await Invitation.findOneAndUpdate(
		{ platformAdmin: true, email: normalized, status: "pending" },
		{ $set: { tokenHash, expiresAt: getInviteExpiry(), invitedBy: inviter.userId } },
		{ upsert: true, new: true, setDefaultsOnInsert: true }
	);
	const delivery = await sendInvitationEmail({ invitation, token, workspaceName: "", inviterName: inviter.name || inviter.email });
	await recordAudit({ actor: inviter, action: "platform.admin.invited", detail: { email: normalized } });
	return { ok: true, invitationId: String(invitation._id), link: inviteUrl(token), ...delivery };
}

export async function revokePlatformInvitation({ invitationId }) {
	await connectDb();
	const { modifiedCount } = await Invitation.updateOne({ _id: invitationId, platformAdmin: true, status: "pending" }, { $set: { status: "revoked" } });
	return modifiedCount ? { ok: true } : { error: "Invitation not found" };
}

// Takes administrator rights away from a person (their account and any workspace they belong to stay). The
// check after the update stops two administrators removing each other at the same moment.
export async function removePlatformAdmin({ actor, userId }) {
	const admins = await listPlatformAdmins();
	const problem = getAdminRemovalProblem({ admins, targetUserId: userId });
	if (problem) return { error: problem };
	await User.updateOne({ _id: userId }, { $set: { isPlatformAdmin: false } });
	if ((await User.countDocuments({ isPlatformAdmin: true, disabledAt: null })) === 0) {
		await User.updateOne({ _id: userId }, { $set: { isPlatformAdmin: true } });
		return { error: "The platform needs at least one administrator. Add another one first." };
	}
	await recordAudit({ actor, action: "platform.admin.removed", detail: { userId: String(userId) } });
	return { ok: true };
}
