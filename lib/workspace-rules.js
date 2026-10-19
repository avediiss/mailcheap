// Pure rules for workspaces: roles, which workspace is active, which sender addresses a workspace may
// use, and which suppressions apply to it. The database calls are in lib/workspace.js.

export const ROLE_RANK = { editor: 1, owner: 2 };

// owner: members, domains, API keys. editor: newsletters, campaigns, contacts.
export function hasRole(role, required) {
	return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[required] ?? Infinity);
}

// The workspace to show: the one picked last if the person may still use it, else their first.
export function pickActiveWorkspace(workspaces, preferredId) {
	if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
	return workspaces.find(({ id }) => id === preferredId) ?? workspaces[0];
}

export function getEmailDomain(email) {
	const at = String(email ?? "").lastIndexOf("@");
	return at < 0 ? "" : String(email).slice(at + 1).trim().toLowerCase();
}

// A workspace may send from its own domains and their subdomains (news.example.com under example.com),
// never from a domain that is merely similar (example.com.evil.test, notexample.com).
export function isSenderAllowed(domains, fromEmail) {
	const domain = getEmailDomain(fromEmail);
	if (!domain) return false;
	return (domains ?? []).some((own) => {
		const owned = String(own).trim().toLowerCase();
		return Boolean(owned) && (domain === owned || domain.endsWith(`.${owned}`));
	});
}

// Bounces are global (no workspaceId); complaints and manual opt-outs belong to one workspace.
export function getSuppressionScope(reason, workspaceId) {
	return reason === "bounce" ? null : (workspaceId ?? null);
}

// Which suppression rows apply to a workspace's sends: the global ones and its own.
export function suppressionFilter(workspaceId) {
	return { $or: [{ workspaceId: null }, { workspaceId }] };
}

// The SES identities that belong to a workspace: its own domains and their subdomains. SES holds every
// workspace's domains in one account, so the list a person sees is cut down to their own.
export function filterDomainsForWorkspace(sesDomains, ownedDomains) {
	return (sesDomains ?? []).filter(({ domain }) => isSenderAllowed(ownedDomains, `x@${domain}`));
}

export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isWorkspaceActive(workspace) {
	return workspace?.status === "active";
}

// null when the workspace may add another of this kind, else the sentence to show.
// Used by the platform owner's limits (Phase 4); null limits mean no limit.
export function getLimitProblem({ limit, current, noun }) {
	if (limit === null || limit === undefined) return null;
	return current >= limit ? `This workspace is at its limit of ${limit} ${noun}.` : null;
}

// Suppression rows for a batch of addresses, indexed so each email can be checked against its own
// workspace in one pass: a global row (a bounce) blocks everyone, a workspace row only that workspace.
export function buildSuppressionIndex(rows) {
	const global = new Set();
	const byWorkspace = new Set();
	for (const { email, workspaceId } of rows ?? []) {
		if (workspaceId) byWorkspace.add(`${workspaceId}|${email}`);
		else global.add(email);
	}
	return { global, byWorkspace };
}

export function isSuppressedFor(index, workspaceId, email) {
	return index.global.has(email) || index.byWorkspace.has(`${workspaceId}|${email}`);
}

// Why this workspace may not send this email right now, or null. Checked for every batch of emails:
// a suspended workspace sends nothing, and a workspace sends only from addresses on its own domains.
export function getSendGateProblem({ workspace, domains, fromEmail }) {
	if (!workspace) return "This email's workspace no longer exists";
	if (!isWorkspaceActive(workspace)) return "This workspace is suspended";
	if (!isSenderAllowed(domains, fromEmail)) return `${fromEmail || "The from address"} is not on one of this workspace's domains`;
	return null;
}
