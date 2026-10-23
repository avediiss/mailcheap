import { LIMITS } from "./config.js";
import { startOfMonth } from "./send-cost.js";

// Pure rules for the platform owner's console: limits, usage meters and deliverability health.

export const LIMIT_FIELDS = [
	{ key: "contacts", label: "Contacts", hint: "People who can be emailed (active, pending, dormant)" },
	{ key: "emailsPerMonth", label: "Emails per month", hint: "Everything sent, except test emails" },
	{ key: "newsletters", label: "Newsletters", hint: "How many newsletters the workspace can have" },
];
const MAX_LIMIT = 1_000_000_000;

// "" means no limit. Anything else must be a whole number, zero or more.
export function parseLimit(value) {
	if (value === null || value === undefined || String(value).trim() === "") return { value: null };
	const text = String(value).trim().replaceAll(",", "").replaceAll(" ", "");
	if (!/^\d+$/.test(text)) return { error: "Use a whole number, or leave it empty for no limit" };
	const number = Number(text);
	if (number > MAX_LIMIT) return { error: "That number is too large" };
	return { value: number };
}

// input: { contacts, emailsPerMonth, newsletters } as typed in a form.
export function readLimits(input) {
	const limits = {};
	for (const { key, label } of LIMIT_FIELDS) {
		const parsed = parseLimit(input?.[key]);
		if (parsed.error) return { error: `${label}: ${parsed.error}` };
		limits[key] = parsed.value;
	}
	return { limits };
}

export function formatLimit(limit) {
	return limit === null || limit === undefined ? "No limit" : limit.toLocaleString("en-US");
}

export const NEAR_LIMIT_RATIO = 0.8;

// A usage bar: how full it is, and whether to worry. No limit means no bar.
export function getUsageMeter({ used, limit }) {
	const count = Math.max(0, Number(used) || 0);
	if (limit === null || limit === undefined) return { used: count, limit: null, ratio: 0, state: "unlimited" };
	const ratio = limit === 0 ? (count > 0 ? 1 : 0) : Math.min(count / limit, 1);
	const state = count >= limit ? "full" : ratio >= NEAR_LIMIT_RATIO ? "near" : "ok";
	return { used: count, limit, ratio, state };
}

// null when a send of this many emails fits in what's left this month, else the sentence to show.
export function getEmailQuotaProblem({ used, limit, needed }) {
	if (limit === null || limit === undefined) return null;
	const left = Math.max(0, limit - used);
	if (needed <= left) return null;
	if (left === 0) return `This workspace has used all ${limit.toLocaleString("en-US")} emails of its monthly limit.`;
	return `This send needs ${needed.toLocaleString("en-US")} emails, but only ${left.toLocaleString("en-US")} are left of this month's ${limit.toLocaleString("en-US")}.`;
}

// How many more contacts can be added: Infinity without a limit.
export function getContactRoom({ used, limit }) {
	if (limit === null || limit === undefined) return Number.POSITIVE_INFINITY;
	return Math.max(0, limit - used);
}

// Enough sends to judge: a single bounce out of five emails means nothing.
export const MIN_SENT_FOR_HEALTH = 50;

// good / watch (over half the pause threshold) / bad (would be paused) / unknown (too few sent).
export function getHealth({ sent, bounced, complained }) {
	if (!sent || sent < MIN_SENT_FOR_HEALTH) return "unknown";
	const bounceRate = bounced / sent;
	const complaintRate = complained / sent;
	if (bounceRate >= LIMITS.bounceRate || complaintRate >= LIMITS.complaintRate) return "bad";
	if (bounceRate >= LIMITS.bounceRate / 2 || complaintRate >= LIMITS.complaintRate / 2) return "watch";
	return "good";
}

export const HEALTH_LABELS = { good: "Healthy", watch: "Watch", bad: "At risk", unknown: "Not enough sends yet" };

export function slugifyWorkspaceName(name) {
	return String(name ?? "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "");
}

export function monthStart(now = new Date()) {
	return startOfMonth(now);
}

// What each recorded action reads like in the activity list.
export const AUDIT_LABELS = {
	"workspace.created": "Workspace created",
	"workspace.renamed": "Renamed",
	"workspace.limits": "Limits changed",
	"workspace.suspended": "Suspended",
	"workspace.resumed": "Resumed",
	"workspace.blocked": "Blocked automatically",
	"workspace.sending": "Sending speed changed",
	"blocklist.added": "Email domain blocked",
	"blocklist.removed": "Email domain unblocked",
	"review.approved": "Flagged issue approved",
	"review.rejected": "Flagged issue turned down",
	"workspace.domain": "Domain assigned",
	"platform.admin.invited": "Platform administrator invited",
	"platform.admin.added": "Platform administrator added",
	"platform.admin.removed": "Platform administrator removed",
	"account.disabled": "Account disabled",
	"account.enabled": "Account enabled",
	"account.signed-out": "Account signed out everywhere",
	"account.reset-sent": "Password reset sent",
	"account.2fa-reset": "Two-factor login removed",
};

// Workspaces worth a look: suspended, at risk, or at a limit. Highest concern first.
export function rankAttention(rows) {
	const score = (row) => {
		let points = 0;
		if (row.health === "bad") points += 100;
		if (row.status === "suspended") points += 40;
		if (row.health === "watch") points += 30;
		if (row.emailsProjection?.state === "over") points += 12;
		for (const meter of [row.contactsMeter, row.emailsMeter, row.newslettersMeter]) {
			if (meter?.state === "full") points += 25;
			else if (meter?.state === "near") points += 10;
		}
		return points;
	};
	return rows
		.map((row) => ({ row, points: score(row) }))
		.filter(({ points }) => points > 0)
		.toSorted((a, b) => b.points - a.points)
		.map(({ row }) => row);
}

// Why a workspace is on the attention list, in words, most serious first.
export function describeAttention(row) {
	const reasons = [];
	if (row.health === "bad") reasons.push("Bounces or complaints are past the pause limit");
	if (row.status === "suspended") reasons.push("Suspended");
	if (row.health === "watch") reasons.push("Bounces or complaints are getting close to the limit");
	const meters = [
		[row.emailsMeter, "Emails"],
		[row.contactsMeter, "Contacts"],
		[row.newslettersMeter, "Newsletters"],
	];
	for (const [meter, label] of meters) if (meter?.state === "full") reasons.push(`${label} limit reached`);
	for (const [meter, label] of meters) if (meter?.state === "near") reasons.push(`${label} close to the limit`);
	if (row.emailsProjection?.state === "over" && row.emailsMeter?.state !== "near") {
		reasons.push(`On pace for about ${row.emailsProjection.projected.toLocaleString("en-US")} emails this month, over its limit`);
	}
	return reasons;
}

// The platform always keeps an administrator: the last one can't be removed, themselves included.
// admins: [{ userId }].
export function getAdminRemovalProblem({ admins, targetUserId }) {
	if (!admins.some(({ userId }) => String(userId) === String(targetUserId))) return "This person is not a platform administrator";
	if (admins.length <= 1) return "The platform needs at least one administrator. Add another one first.";
	return null;
}

// Switching an account off: never your own, and never the last administrator who can still log in.
// admins: [{ userId }] of the enabled administrators. null when it's fine.
export function getAccountDisableProblem({ actorId, target, admins }) {
	if (String(actorId) === String(target.userId)) return "You can't disable your own account";
	if (target.isPlatformAdmin && !admins.some(({ userId }) => String(userId) !== String(target.userId))) {
		return "That is the only platform administrator who can log in. Add another one first.";
	}
	return null;
}
