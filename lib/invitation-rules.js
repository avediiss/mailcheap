import { ROLES, describeRole, roleLabel } from "./roles.js";

export { describeRole, roleLabel };
import { createResetToken, hashResetToken, looksLikeResetToken } from "./session-rules.js";

// Pure rules for inviting people and managing members. The database calls are in lib/members.js.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITATIONS = 50;

// The same kind of random token as a password-reset link: 32 random bytes, only the hash is stored.
export const createInviteToken = createResetToken;
export const hashInviteToken = hashResetToken;
export const looksLikeInviteToken = looksLikeResetToken;

export function getInviteExpiry(now = Date.now()) {
	return new Date(now + INVITE_TTL_MS);
}

export function isInviteUsable(invitation, now = Date.now()) {
	return Boolean(invitation) && invitation.status === "pending" && new Date(invitation.expiresAt).getTime() > now;
}

// Why this invitation can't be used, for the page the link opens.
export function getInviteState(invitation, now = Date.now()) {
	if (!invitation) return "invalid";
	if (invitation.status === "accepted") return "accepted";
	if (invitation.status === "revoked") return "revoked";
	return new Date(invitation.expiresAt).getTime() > now ? "usable" : "expired";
}

// null when this address can be invited, else the sentence to show.
export function getInviteProblem({ email, role, memberEmails = [], pendingCount = 0 }) {
	if (!email) return "Enter a valid email address";
	if (!ROLES.includes(role)) return "Pick a role";
	if (memberEmails.map((address) => address.toLowerCase()).includes(email)) return `${email} is already in this workspace`;
	if (pendingCount >= MAX_PENDING_INVITATIONS) return `A workspace can have at most ${MAX_PENDING_INVITATIONS} open invitations`;
	return null;
}

// A workspace always keeps an owner: nobody can remove or demote the last one, themselves included.
// members: [{ userId, role }]. action: "remove" or "role" (with newRole).
export function getMemberChangeProblem({ members, targetUserId, action, newRole }) {
	const target = members.find(({ userId }) => String(userId) === String(targetUserId));
	if (!target) return "This person is not in the workspace";
	if (action === "role" && !ROLES.includes(newRole)) return "Pick a role";
	if (action === "role" && newRole === target.role) return null;
	const loosesOwner = target.role === "owner" && (action === "remove" || newRole !== "owner");
	const ownerCount = members.filter(({ role }) => role === "owner").length;
	if (loosesOwner && ownerCount <= 1) return "A workspace needs at least one owner. Make someone else an owner first.";
	return null;
}
