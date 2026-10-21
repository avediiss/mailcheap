import "server-only";
import { getAppUrl, isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { buildInvitationEmail } from "@/lib/invitation-email";
import {
	createInviteToken,
	getInviteExpiry,
	getInviteProblem,
	getInviteState,
	getMemberChangeProblem,
	hashInviteToken,
	looksLikeInviteToken,
} from "@/lib/invitation-rules";
import { hashPassword } from "@/lib/passwords";
import { getPasswordProblem } from "@/lib/passwords-rules";
import { sendSesEmail } from "@/lib/ses";
import { normalizeEmail } from "@/lib/validation";
import Invitation from "@/models/Invitation";
import Membership from "@/models/Membership";
import User from "@/models/User";
import Workspace from "@/models/Workspace";

const MAX_NAME_LENGTH = 120;

// Invitations go out from the platform's own address, like password resets.
function getFromAddress() {
	return process.env.PLATFORM_FROM || process.env.ALERT_FROM || "";
}

export function getInviteUrl(token) {
	return `${getAppUrl()}/invite/${token}`;
}

export async function listMembers(workspaceId) {
	await connectDb();
	const memberships = await Membership.find({ workspaceId }).sort({ createdAt: 1 }).lean();
	const users = await User.find({ _id: { $in: memberships.map(({ userId }) => userId) } })
		.select({ email: 1, name: 1, lastLoginAt: 1, disabledAt: 1 })
		.lean();
	const byId = new Map(users.map((user) => [String(user._id), user]));
	return memberships
		.map((membership) => {
			const user = byId.get(String(membership.userId));
			return user && {
				userId: String(membership.userId),
				email: user.email,
				name: user.name ?? "",
				role: membership.role,
				joinedAt: membership.createdAt,
				lastLoginAt: user.lastLoginAt ?? null,
				isDisabled: Boolean(user.disabledAt),
			};
		})
		.filter(Boolean);
}

export async function listInvitations(workspaceId) {
	await connectDb();
	const rows = await Invitation.find({ workspaceId, status: "pending" }).sort({ createdAt: -1 }).lean();
	return rows.map((row) => ({
		id: String(row._id),
		email: row.email,
		role: row.role,
		expiresAt: row.expiresAt,
		lastSentAt: row.lastSentAt ?? null,
		isExpired: getInviteState(row) === "expired",
	}));
}

async function sendInvitationEmail({ invitation, token, workspaceName, inviterName }) {
	const from = getFromAddress();
	if (!from) return { emailed: false, reason: "Invitation emails need PLATFORM_FROM (or ALERT_FROM) to be set." };
	if (!isSendingEnabled()) return { emailed: false, reason: "Sending is off, so no email was sent." };
	try {
		const { subject, text, html } = buildInvitationEmail({
			url: getInviteUrl(token),
			workspaceName,
			inviterName,
			role: invitation.role,
		});
		await sendSesEmail({ from, to: invitation.email, subject, text, html });
		await Invitation.updateOne({ _id: invitation._id }, { $set: { lastSentAt: new Date() } });
		return { emailed: true };
	} catch (error) {
		console.error("[members] Invitation email failed:", error.message);
		return { emailed: false, reason: "The email couldn't be sent." };
	}
}

// Inviting an address that already has an open invitation refreshes it (new link, new expiry).
export async function inviteMember({ workspaceId, inviter, email, role }) {
	const normalized = normalizeEmail(email);
	await connectDb();
	const [members, pendingCount, workspace] = await Promise.all([
		listMembers(workspaceId),
		Invitation.countDocuments({ workspaceId, status: "pending" }),
		Workspace.findById(workspaceId).select({ name: 1 }).lean(),
	]);
	const problem = getInviteProblem({ email: normalized, role, memberEmails: members.map(({ email: address }) => address), pendingCount });
	if (problem) return { error: problem };
	if (!workspace) return { error: "Workspace not found" };

	const { token, tokenHash } = createInviteToken();
	const invitation = await Invitation.findOneAndUpdate(
		{ workspaceId, email: normalized, status: "pending" },
		{ $set: { role, tokenHash, expiresAt: getInviteExpiry(), invitedBy: inviter.userId } },
		{ upsert: true, new: true, setDefaultsOnInsert: true }
	);
	const delivery = await sendInvitationEmail({ invitation, token, workspaceName: workspace.name, inviterName: inviter.name || inviter.email });
	return { ok: true, invitationId: String(invitation._id), link: getInviteUrl(token), ...delivery };
}

// A new link for an open invitation (the old one stops working). email: send it again too.
export async function renewInvitation({ workspaceId, invitationId, inviter, sendEmail }) {
	await connectDb();
	const { token, tokenHash } = createInviteToken();
	const invitation = await Invitation.findOneAndUpdate(
		{ _id: invitationId, workspaceId, status: "pending" },
		{ $set: { tokenHash, expiresAt: getInviteExpiry() } },
		{ new: true }
	);
	if (!invitation) return { error: "Invitation not found" };
	const link = getInviteUrl(token);
	if (!sendEmail) return { ok: true, link };
	const workspace = await Workspace.findById(workspaceId).select({ name: 1 }).lean();
	const delivery = await sendInvitationEmail({ invitation, token, workspaceName: workspace?.name ?? "a workspace", inviterName: inviter.name || inviter.email });
	return { ok: true, link, ...delivery };
}

export async function revokeInvitation({ workspaceId, invitationId }) {
	await connectDb();
	const { modifiedCount } = await Invitation.updateOne({ _id: invitationId, workspaceId, status: "pending" }, { $set: { status: "revoked" } });
	return modifiedCount ? { ok: true } : { error: "Invitation not found" };
}

// What the link's page needs: whether it can be used, who it is for, and whether they already have an account.
export async function findInvitationByToken(token) {
	if (!looksLikeInviteToken(token)) return { state: "invalid" };
	await connectDb();
	const invitation = await Invitation.findOne({ tokenHash: hashInviteToken(token) }).lean();
	if (!invitation) return { state: "invalid" };
	const state = getInviteState(invitation);
	const [workspace, user] = await Promise.all([
		Workspace.findById(invitation.workspaceId).select({ name: 1, status: 1 }).lean(),
		User.findOne({ email: invitation.email }).select({ _id: 1, disabledAt: 1 }).lean(),
	]);
	return {
		state: workspace ? state : "invalid",
		email: invitation.email,
		role: invitation.role,
		workspaceName: workspace?.name ?? "",
		hasAccount: Boolean(user),
		isAccountDisabled: Boolean(user?.disabledAt),
	};
}

// Claims the invitation first, atomically, so a link can only be used once even if clicked twice at the same
// moment. If what follows fails, the claim is released.
async function claimInvitation(token) {
	if (!looksLikeInviteToken(token)) return null;
	return Invitation.findOneAndUpdate(
		{ tokenHash: hashInviteToken(token), status: "pending", expiresAt: { $gt: new Date() } },
		{ $set: { status: "accepted", acceptedAt: new Date() } },
		{ new: true }
	);
}

async function releaseInvitation(invitation) {
	await Invitation.updateOne({ _id: invitation._id }, { $set: { status: "pending" }, $unset: { acceptedAt: 1, acceptedBy: 1 } });
}

async function addMembership({ userId, workspaceId, role }) {
	try {
		await Membership.create({ userId, workspaceId, role });
	} catch (error) {
		if (error?.code !== 11000) throw error;
		// Already a member (invited twice by mistake): they keep the higher of the two roles.
		if (role === "owner") await Membership.updateOne({ userId, workspaceId }, { $set: { role: "owner" } });
	}
}

// Someone with no account yet: the invitation's address, a name and a password make one.
export async function acceptInvitationNewUser({ token, name, password }) {
	const problem = getPasswordProblem(password);
	if (problem) return { error: problem };
	await connectDb();
	const invitation = await claimInvitation(token);
	if (!invitation) return { error: "This invitation has expired or was already used. Ask for a new one." };

	try {
		if (await User.exists({ email: invitation.email })) {
			await releaseInvitation(invitation);
			return { error: "This address already has an account. Log in to accept the invitation." };
		}
		const user = await User.create({
			email: invitation.email,
			name: String(name ?? "").trim().slice(0, MAX_NAME_LENGTH) || undefined,
			passwordHash: await hashPassword(password),
		});
		await addMembership({ userId: user._id, workspaceId: invitation.workspaceId, role: invitation.role });
		await Invitation.updateOne({ _id: invitation._id }, { $set: { acceptedBy: user._id } });
		return { ok: true, user, workspaceId: String(invitation.workspaceId) };
	} catch (error) {
		await releaseInvitation(invitation);
		throw error;
	}
}

// Someone who already has an account and is logged in as the invited address.
export async function acceptInvitationExistingUser({ token, session }) {
	await connectDb();
	const invitation = await claimInvitation(token);
	if (!invitation) return { error: "This invitation has expired or was already used. Ask for a new one." };
	if (invitation.email !== session.email) {
		await releaseInvitation(invitation);
		return { error: `This invitation is for ${invitation.email}. You're signed in as ${session.email}.` };
	}
	await addMembership({ userId: session.userId, workspaceId: invitation.workspaceId, role: invitation.role });
	await Invitation.updateOne({ _id: invitation._id }, { $set: { acceptedBy: session.userId } });
	return { ok: true, workspaceId: String(invitation.workspaceId) };
}

async function listRoles(workspaceId) {
	return (await Membership.find({ workspaceId }).select({ userId: 1, role: 1 }).lean()).map(({ userId, role }) => ({ userId: String(userId), role }));
}

// After any change that could remove an owner, check again: two owners removing each other at the same
// moment must not leave a workspace with nobody in charge.
async function ensureAnOwner(workspaceId, undo) {
	if ((await Membership.countDocuments({ workspaceId, role: "owner" })) > 0) return true;
	await undo();
	return false;
}

export async function changeMemberRole({ workspaceId, userId, role }) {
	await connectDb();
	const members = await listRoles(workspaceId);
	const problem = getMemberChangeProblem({ members, targetUserId: userId, action: "role", newRole: role });
	if (problem) return { error: problem };
	const before = members.find((member) => member.userId === String(userId)).role;
	await Membership.updateOne({ userId, workspaceId }, { $set: { role } });
	if (!(await ensureAnOwner(workspaceId, () => Membership.updateOne({ userId, workspaceId }, { $set: { role: before } })))) {
		return { error: "A workspace needs at least one owner. Make someone else an owner first." };
	}
	return { ok: true };
}

export async function removeMember({ workspaceId, userId }) {
	await connectDb();
	const members = await listRoles(workspaceId);
	const problem = getMemberChangeProblem({ members, targetUserId: userId, action: "remove" });
	if (problem) return { error: problem };
	const removed = members.find((member) => member.userId === String(userId));
	await Membership.deleteOne({ userId, workspaceId });
	if (!(await ensureAnOwner(workspaceId, () => Membership.create({ userId, workspaceId, role: removed.role })))) {
		return { error: "A workspace needs at least one owner. Make someone else an owner first." };
	}
	return { ok: true };
}
