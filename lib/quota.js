import "server-only";
import { connectDb } from "@/lib/db";
import { getContactRoom, getEmailQuotaProblem, getUsageMeter, monthStart } from "@/lib/platform-rules";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Workspace from "@/models/Workspace";

// A workspace's limits (set by the platform owner) against what it uses. No limit set means no limit.

export class QuotaError extends Error {
	constructor(message) {
		super(message);
		this.name = "QuotaError";
	}
}

// "Contacts" are the people the workspace can email: not those who left.
export const COUNTED_CONTACT_STATUSES = ["active", "pending", "dormant"];

export function readLimitsOf(workspace) {
	const limits = workspace?.limits ?? {};
	const clean = (value) => (typeof value === "number" ? value : null);
	return { contacts: clean(limits.contacts), emailsPerMonth: clean(limits.emailsPerMonth), newsletters: clean(limits.newsletters) };
}

export async function getWorkspaceLimits(workspaceId) {
	await connectDb();
	return readLimitsOf(await Workspace.findById(workspaceId).select({ limits: 1 }).lean());
}

export function countContactsUsed(workspaceId) {
	return Contact.countDocuments({ workspaceId, status: { $in: COUNTED_CONTACT_STATUSES } });
}

// Test emails are the owner's own checks: they don't count against the allowance.
export function countEmailsThisMonth(workspaceId, now = new Date()) {
	return Message.countDocuments({ workspaceId, sentAt: { $gte: monthStart(now) }, kind: { $ne: "test" } });
}

export async function getWorkspaceUsage(workspaceId, now = new Date()) {
	await connectDb();
	const [limits, contacts, emails, newsletters] = await Promise.all([
		getWorkspaceLimits(workspaceId),
		countContactsUsed(workspaceId),
		countEmailsThisMonth(workspaceId, now),
		Newsletter.countDocuments({ workspaceId }),
	]);
	return {
		limits,
		used: { contacts, emailsPerMonth: emails, newsletters },
		meters: {
			contacts: getUsageMeter({ used: contacts, limit: limits.contacts }),
			emailsPerMonth: getUsageMeter({ used: emails, limit: limits.emailsPerMonth }),
			newsletters: getUsageMeter({ used: newsletters, limit: limits.newsletters }),
		},
	};
}

// How many more contacts can be added. room is Infinity without a limit.
export async function getContactRoomFor(workspaceId) {
	const limits = await getWorkspaceLimits(workspaceId);
	if (limits.contacts === null) return { room: Number.POSITIVE_INFINITY, limit: null, used: null };
	const used = await countContactsUsed(workspaceId);
	return { room: getContactRoom({ used, limit: limits.contacts }), limit: limits.contacts, used };
}

export const CONTACT_LIMIT_MESSAGE = "This workspace has reached its contact limit.";

// Throws QuotaError when a send of `needed` emails doesn't fit in what's left this month.
export async function assertEmailRoom({ workspaceId, needed }) {
	const limits = await getWorkspaceLimits(workspaceId);
	if (limits.emailsPerMonth === null) return;
	const used = await countEmailsThisMonth(workspaceId);
	const problem = getEmailQuotaProblem({ used, limit: limits.emailsPerMonth, needed });
	if (problem) throw new QuotaError(problem);
}

// For a batch of emails: each workspace's limit and what it has used so far, loaded once.
export async function loadEmailBudgets(workspaces) {
	const budgets = new Map();
	await Promise.all(
		[...workspaces].map(async (workspace) => {
			const { emailsPerMonth } = readLimitsOf(workspace);
			if (emailsPerMonth === null) return;
			budgets.set(String(workspace._id), { limit: emailsPerMonth, used: await countEmailsThisMonth(workspace._id) });
		})
	);
	return budgets;
}
