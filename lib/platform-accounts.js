import "server-only";
import { recordAudit } from "@/lib/audit";
import { connectDb } from "@/lib/db";
import { requestPasswordReset } from "@/lib/password-reset";
import { getAccountDisableProblem } from "@/lib/platform-rules";
import Membership from "@/models/Membership";
import User from "@/models/User";
import Workspace from "@/models/Workspace";

export const ACCOUNTS_PAGE_SIZE = 100;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Every login on the platform, with the workspaces each belongs to. `query` matches part of an email or name.
export async function listAccounts({ query = "", limit = ACCOUNTS_PAGE_SIZE } = {}) {
	await connectDb();
	const text = String(query).trim().slice(0, 80);
	const filter = text ? { $or: [{ email: { $regex: escapeRegex(text), $options: "i" } }, { name: { $regex: escapeRegex(text), $options: "i" } }] } : {};
	const [users, total] = await Promise.all([
		User.find(filter).sort({ lastLoginAt: -1, createdAt: -1 }).limit(limit).select({ email: 1, name: 1, isPlatformAdmin: 1, disabledAt: 1, lastLoginAt: 1, createdAt: 1, "twoFactor.enabledAt": 1 }).lean(),
		User.countDocuments(filter),
	]);
	const memberships = await Membership.find({ userId: { $in: users.map(({ _id }) => _id) } }).select({ userId: 1, workspaceId: 1, role: 1 }).lean();
	const workspaces = await Workspace.find({ _id: { $in: memberships.map(({ workspaceId }) => workspaceId) } }).select({ name: 1 }).lean();
	const names = new Map(workspaces.map(({ _id, name }) => [String(_id), name]));

	return {
		total,
		accounts: users.map((user) => ({
			id: String(user._id),
			email: user.email,
			name: user.name ?? "",
			isPlatformAdmin: Boolean(user.isPlatformAdmin),
			isDisabled: Boolean(user.disabledAt),
			hasTwoFactor: Boolean(user.twoFactor?.enabledAt),
			lastLoginAt: user.lastLoginAt ?? null,
			createdAt: user.createdAt,
			memberships: memberships
				.filter(({ userId }) => String(userId) === String(user._id))
				.map(({ workspaceId, role }) => ({ workspaceId: String(workspaceId), name: names.get(String(workspaceId)) ?? "A workspace", role })),
		})),
	};
}

async function findAccount(userId) {
	await connectDb();
	return User.findById(userId).select({ email: 1, isPlatformAdmin: 1, disabledAt: 1 }).lean();
}

// Disabled accounts can't log in, and any session they have stops working at once.
export async function setAccountDisabled({ actor, userId, disabled }) {
	const user = await findAccount(userId);
	if (!user) return { error: "Account not found" };
	if (disabled) {
		const admins = (await User.find({ isPlatformAdmin: true, disabledAt: null }).select({ _id: 1 }).lean()).map(({ _id }) => ({ userId: String(_id) }));
		const problem = getAccountDisableProblem({ actorId: actor.userId, target: { userId: String(user._id), isPlatformAdmin: user.isPlatformAdmin }, admins });
		if (problem) return { error: problem };
		await User.updateOne({ _id: user._id }, { $set: { disabledAt: new Date() }, $inc: { sessionVersion: 1 } });
	} else {
		await User.updateOne({ _id: user._id }, { $unset: { disabledAt: 1 } });
	}
	await recordAudit({ actor, action: disabled ? "account.disabled" : "account.enabled", detail: { email: user.email } });
	return { ok: true };
}

export async function signOutAccount({ actor, userId }) {
	const user = await findAccount(userId);
	if (!user) return { error: "Account not found" };
	await User.updateOne({ _id: user._id }, { $inc: { sessionVersion: 1 } });
	await recordAudit({ actor, action: "account.signed-out", detail: { email: user.email } });
	return { ok: true };
}

// The same email "Forgot your password?" sends, to that account's address.
export async function sendAccountReset({ actor, userId }) {
	const user = await findAccount(userId);
	if (!user) return { error: "Account not found" };
	if (user.disabledAt) return { error: "Enable this account first" };
	await requestPasswordReset(user.email);
	await recordAudit({ actor, action: "account.reset-sent", detail: { email: user.email } });
	return { ok: true };
}
