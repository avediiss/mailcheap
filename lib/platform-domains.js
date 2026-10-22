import "server-only";
import { connectDb } from "@/lib/db";
import { describeDomainStatus } from "@/lib/domain-rules";
import { listSesDomains } from "@/lib/ses";
import { isSenderAllowed } from "@/lib/workspace-rules";
import Domain from "@/models/Domain";
import Workspace from "@/models/Workspace";

const DAY_MS = 24 * 60 * 60 * 1000;
// DNS usually settles within hours; a domain still waiting after this long needs a nudge to its owner.
export const STUCK_AFTER_DAYS = 3;

// Every client's sending domains with their live state in SES, worst first, plus identities that exist in SES
// but belong to no workspace.
export async function listPlatformDomains({ now = new Date(), fresh = false } = {}) {
	await connectDb();
	const [rows, workspaces, ses] = await Promise.all([Domain.find().sort({ createdAt: 1 }).lean(), Workspace.find().select({ name: 1 }).lean(), listSesDomains({ fresh })]);
	const sesError = Array.isArray(ses) ? null : ses.error;
	const entries = Array.isArray(ses) ? ses : [];
	const names = new Map(workspaces.map(({ _id, name }) => [String(_id), name]));
	const byName = new Map(entries.map((entry) => [entry.domain, entry]));

	const domains = rows.map((row) => {
		const entry = byName.get(row.domain) ?? null;
		const status = sesError ? { key: "unknown", label: "Unknown", hint: "The sending service couldn't be reached." } : describeDomainStatus({ ses: entry });
		const ageDays = Math.floor((now.getTime() - new Date(row.createdAt).getTime()) / DAY_MS);
		return {
			id: String(row._id),
			domain: row.domain,
			workspaceId: String(row.workspaceId),
			workspaceName: names.get(String(row.workspaceId)) ?? "A workspace",
			status,
			dkimStatus: entry?.dkimStatus ?? null,
			mailFromStatus: entry?.mailFromStatus ?? null,
			ageDays,
			isStuck: (status.key === "pending" || status.key === "missing") && ageDays >= STUCK_AFTER_DAYS,
		};
	});
	const rank = (domain) => (domain.isStuck ? 0 : domain.status.key === "verified" ? 3 : domain.status.key === "unknown" ? 2 : 1);
	domains.sort((a, b) => rank(a) - rank(b) || a.domain.localeCompare(b.domain));

	const owned = rows.map(({ domain }) => domain);
	const unassigned = entries.filter(({ domain }) => !isSenderAllowed(owned, `x@${domain}`)).map(({ domain, verified }) => ({ domain, verified }));
	return { sesError, domains, unassigned };
}
