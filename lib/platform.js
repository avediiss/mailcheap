import "server-only";
import { connectDb } from "@/lib/db";
import { getHealth, getUsageMeter, monthStart } from "@/lib/platform-rules";
import { COUNTED_CONTACT_STATUSES, readLimitsOf } from "@/lib/quota";
import Contact from "@/models/Contact";
import Domain from "@/models/Domain";
import Membership from "@/models/Membership";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Workspace from "@/models/Workspace";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_DAYS = 30;

const byWorkspace = (rows) => new Map(rows.map(({ _id, ...rest }) => [String(_id), rest]));

// Everything the platform console shows about each workspace, in a handful of grouped queries (not one set
// per workspace), so it stays quick with many clients.
export async function listWorkspaceSummaries({ now = new Date() } = {}) {
	await connectDb();
	const since = new Date(now.getTime() - HEALTH_DAYS * DAY_MS);
	const [workspaces, contacts, newsletters, members, month, health] = await Promise.all([
		Workspace.find().sort({ createdAt: 1 }).lean(),
		Contact.aggregate([
			{ $group: { _id: "$workspaceId", total: { $sum: 1 }, counted: { $sum: { $cond: [{ $in: ["$status", COUNTED_CONTACT_STATUSES] }, 1, 0] } } } },
		]),
		Newsletter.aggregate([{ $group: { _id: "$workspaceId", count: { $sum: 1 } } }]),
		Membership.aggregate([{ $group: { _id: "$workspaceId", count: { $sum: 1 } } }]),
		Message.aggregate([
			{ $match: { sentAt: { $gte: monthStart(now) }, kind: { $ne: "test" } } },
			{ $group: { _id: "$workspaceId", count: { $sum: 1 } } },
		]),
		Message.aggregate([
			{ $match: { sentAt: { $gte: since }, kind: { $ne: "test" } } },
			{
				$group: {
					_id: "$workspaceId",
					sent: { $sum: 1 },
					bounced: { $sum: { $cond: [{ $gt: ["$bouncedAt", null] }, 1, 0] } },
					complained: { $sum: { $cond: [{ $gt: ["$complainedAt", null] }, 1, 0] } },
				},
			},
		]),
	]);
	const contactsBy = byWorkspace(contacts);
	const newslettersBy = byWorkspace(newsletters);
	const membersBy = byWorkspace(members);
	const monthBy = byWorkspace(month);
	const healthBy = byWorkspace(health);

	return workspaces.map((workspace) => {
		const key = String(workspace._id);
		const limits = readLimitsOf(workspace);
		const usedContacts = contactsBy.get(key)?.counted ?? 0;
		const emails = monthBy.get(key)?.count ?? 0;
		const newslettersCount = newslettersBy.get(key)?.count ?? 0;
		const { sent = 0, bounced = 0, complained = 0 } = healthBy.get(key) ?? {};
		return {
			id: key,
			name: workspace.name,
			slug: workspace.slug,
			status: workspace.status,
			createdAt: workspace.createdAt,
			members: membersBy.get(key)?.count ?? 0,
			newsletters: newslettersCount,
			contacts: usedContacts,
			contactsTotal: contactsBy.get(key)?.total ?? 0,
			emailsThisMonth: emails,
			sent30: sent,
			bounced30: bounced,
			complained30: complained,
			health: getHealth({ sent, bounced, complained }),
			limits,
			contactsMeter: getUsageMeter({ used: usedContacts, limit: limits.contacts }),
			emailsMeter: getUsageMeter({ used: emails, limit: limits.emailsPerMonth }),
			newslettersMeter: getUsageMeter({ used: newslettersCount, limit: limits.newsletters }),
		};
	});
}

// Sums for the overview cards. Health is judged on the whole platform's last 30 days, since SES judges the
// one shared account.
export function getPlatformTotals(rows) {
	const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
	const sent = sum("sent30");
	const bounced = sum("bounced30");
	const complained = sum("complained30");
	return {
		workspaces: rows.length,
		active: rows.filter(({ status }) => status === "active").length,
		suspended: rows.filter(({ status }) => status === "suspended").length,
		contacts: sum("contacts"),
		emailsThisMonth: sum("emailsThisMonth"),
		sent30: sent,
		bounced30: bounced,
		complained30: complained,
		bounceRate: sent ? bounced / sent : 0,
		complaintRate: sent ? complained / sent : 0,
		health: getHealth({ sent, bounced, complained }),
	};
}

export async function getWorkspaceDetail(workspaceId) {
	await connectDb();
	const summaries = await listWorkspaceSummaries();
	const summary = summaries.find(({ id }) => id === String(workspaceId));
	if (!summary) return null;
	const [domains, newsletters] = await Promise.all([
		Domain.find({ workspaceId }).sort({ createdAt: 1 }).select({ domain: 1, createdInSes: 1 }).lean(),
		Newsletter.find({ workspaceId }).sort({ createdAt: 1 }).select({ name: 1, slug: 1, fromEmail: 1 }).lean(),
	]);
	return {
		summary,
		domains: domains.map(({ _id, domain }) => ({ id: String(_id), domain })),
		newsletters: newsletters.map(({ _id, name, slug, fromEmail }) => ({ id: String(_id), name, slug, fromEmail })),
	};
}
