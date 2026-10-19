import "server-only";
import { connectDb } from "@/lib/db";
import { describeDomainStatus, findDomainConflict, getDomainProblem, normalizeDomain } from "@/lib/domain-rules";
import { createSesDomainIdentity, deleteSesDomainIdentity, listSesDomains } from "@/lib/ses";
import { isSenderAllowed } from "@/lib/workspace-rules";
import Domain from "@/models/Domain";
import Newsletter from "@/models/Newsletter";

// A workspace's domains with their live state in SES (verification, DNS records). When SES can't be reached
// the domains are still listed, with the error, so the page never goes blank.
export async function listWorkspaceDomainStatuses(workspaceId, { fresh = false } = {}) {
	await connectDb();
	const [rows, ses] = await Promise.all([Domain.find({ workspaceId }).sort({ createdAt: 1 }).lean(), listSesDomains({ fresh })]);
	const sesError = Array.isArray(ses) ? null : ses.error;
	const byName = new Map((Array.isArray(ses) ? ses : []).map((entry) => [entry.domain, entry]));
	return {
		sesError,
		domains: rows.map((row) => {
			const entry = byName.get(row.domain) ?? null;
			return {
				id: String(row._id),
				domain: row.domain,
				canRemove: true,
				createdInSes: row.createdInSes,
				dkimStatus: entry?.dkimStatus ?? null,
				mailFromDomain: entry?.mailFromDomain ?? null,
				mailFromStatus: entry?.mailFromStatus ?? null,
				records: entry?.records ?? [],
				status: sesError ? { key: "unknown", label: "Unknown", hint: "The sending service couldn't be reached." } : describeDomainStatus({ ses: entry }),
			};
		}),
	};
}

const SES_MESSAGES = {
	denied: "The platform's AWS user isn't allowed to add domains yet. The platform owner needs to allow ses:CreateEmailIdentity and ses:PutEmailIdentityMailFromAttributes.",
	failed: "The sending service couldn't add this domain. Try again in a moment.",
	exists: "This domain is already set up in the sending service. Ask the platform owner to assign it to your workspace.",
};

export async function addWorkspaceDomain({ workspaceId, userId, input, isPlatformAdmin = false }) {
	const domain = normalizeDomain(input);
	const problem = getDomainProblem(domain);
	if (problem) return { error: problem };

	await connectDb();
	const taken = (await Domain.find().select({ domain: 1 }).lean()).map((row) => row.domain);
	const conflict = findDomainConflict(domain, taken);
	if (conflict) {
		return { error: conflict === domain ? "This domain is already used by a workspace." : `${conflict} is already used by another workspace, so ${domain} can't be added.` };
	}

	const created = await createSesDomainIdentity(domain);
	// A domain that already exists in SES without a workspace is the platform owner's to hand out: a client
	// adopting it could send as a domain they may not control.
	const adopt = created.error === "exists" && isPlatformAdmin;
	if (created.error && !adopt) {
		if (created.detail) console.error(`[domains] SES refused ${domain}: ${created.detail}`);
		return { error: SES_MESSAGES[created.error] ?? SES_MESSAGES.failed };
	}
	try {
		await Domain.create({ workspaceId, domain, createdInSes: !adopt, addedBy: userId });
	} catch (error) {
		if (error?.code === 11000) return { error: "This domain is already used by a workspace." };
		throw error;
	}
	return { ok: true, domain };
}

export async function removeWorkspaceDomain({ workspaceId, domainId }) {
	await connectDb();
	const row = await Domain.findOne({ _id: domainId, workspaceId }).lean();
	if (!row) return { error: "Domain not found" };

	// A newsletter still sending from it would stop being able to send.
	const newsletters = await Newsletter.find({ workspaceId }).select({ name: 1, fromEmail: 1 }).lean();
	const using = newsletters.filter(({ fromEmail }) => isSenderAllowed([row.domain], fromEmail));
	if (using.length > 0) {
		return { error: `${using.map(({ name }) => name).join(", ")} still sends from ${row.domain}. Change its from address first.` };
	}

	if (row.createdInSes) {
		const removed = await deleteSesDomainIdentity(row.domain);
		if (removed.error) return { error: "The sending service couldn't remove this domain. Try again in a moment." };
	}
	await Domain.deleteOne({ _id: row._id });
	return { ok: true };
}
