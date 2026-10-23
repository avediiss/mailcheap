"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { addWorkspaceDomain } from "@/lib/domains";
import { inviteMember } from "@/lib/members";
import { clearAddressCaches } from "@/lib/address-check";
import { decideReview } from "@/lib/content-review";
import { getDomainProblem, normalizeDomain } from "@/lib/domain-rules";
import { resetTwoFactor } from "@/lib/two-factor";
import { sendAccountReset, setAccountDisabled, signOutAccount } from "@/lib/platform-accounts";
import { invitePlatformAdmin, removePlatformAdmin, revokePlatformInvitation } from "@/lib/platform-team";
import { readLimits, slugifyWorkspaceName } from "@/lib/platform-rules";
import { normalizeEmail } from "@/lib/validation";
import BlockedDomain from "@/models/BlockedDomain";
import Workspace from "@/models/Workspace";

const MAX_NAME_LENGTH = 80;

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

function readLimitInput(formData) {
	return { contacts: formData.get("contacts"), emailsPerMonth: formData.get("emailsPerMonth"), newsletters: formData.get("newsletters") };
}

// A slug nobody has: "acme", then "acme-2", "acme-3"...
async function findFreeSlug(name) {
	const base = slugifyWorkspaceName(name) || "workspace";
	for (let attempt = 1; attempt < 50; attempt++) {
		const slug = attempt === 1 ? base : `${base.slice(0, 36)}-${attempt}`;
		if (!(await Workspace.exists({ slug }))) return slug;
	}
	return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

// A new client: the workspace, its limits, and an invitation to its first owner.
export async function createWorkspace(_state, formData) {
	const session = await requirePlatformAdmin();
	const name = readText(formData, "name");
	if (name.length < 2 || name.length > MAX_NAME_LENGTH) return { error: `Give the workspace a name of 2 to ${MAX_NAME_LENGTH} characters` };
	const ownerEmail = normalizeEmail(readText(formData, "ownerEmail"));
	if (!ownerEmail) return { error: "Enter the first owner's email address" };
	const { limits, error } = readLimits(readLimitInput(formData));
	if (error) return { error };

	await connectDb();
	const workspace = await Workspace.create({ name, slug: await findFreeSlug(name), limits });
	await recordAudit({ actor: session, workspaceId: workspace._id, action: "workspace.created", detail: { name, limits, ownerEmail } });

	const invitation = await inviteMember({ workspaceId: workspace._id, inviter: session, email: ownerEmail, role: "owner" });
	revalidatePath("/platform", "layout");
	return {
		ok: true,
		workspaceId: String(workspace._id),
		name,
		// The workspace exists either way; if the invitation couldn't be made, say so and give what there is.
		invitationError: invitation.error ?? null,
		link: invitation.link ?? null,
		emailed: Boolean(invitation.emailed),
		reason: invitation.reason ?? null,
	};
}

export async function updateWorkspace(_state, formData) {
	const session = await requirePlatformAdmin();
	const id = readText(formData, "id");
	if (!isValidObjectId(id)) return { error: "Workspace not found" };
	const name = readText(formData, "name");
	if (name.length < 2 || name.length > MAX_NAME_LENGTH) return { error: `Give the workspace a name of 2 to ${MAX_NAME_LENGTH} characters` };
	const { limits, error } = readLimits(readLimitInput(formData));
	if (error) return { error };

	await connectDb();
	const before = await Workspace.findById(id).select({ name: 1, limits: 1 }).lean();
	if (!before) return { error: "Workspace not found" };
	await Workspace.updateOne({ _id: id }, { $set: { name, limits } });
	if (before.name !== name) await recordAudit({ actor: session, workspaceId: id, action: "workspace.renamed", detail: { from: before.name, to: name } });
	if (JSON.stringify(before.limits ?? {}) !== JSON.stringify(limits)) {
		await recordAudit({ actor: session, workspaceId: id, action: "workspace.limits", detail: { limits } });
	}
	revalidatePath("/platform", "layout");
	return { ok: true };
}

// Suspending stops sending, signups and the API for the workspace; its people can still log in and look.
export async function setWorkspaceStatus(id, status) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(id) || !["active", "suspended"].includes(status)) return { error: "Workspace not found" };
	await connectDb();
	// Resuming also clears an automatic block and starts counting bounces and complaints again from now, so the
	// emails that caused it don't block the workspace again at once.
	const update = status === "active" ? { $set: { status, healthResetAt: new Date() }, $unset: { blockedAt: 1, blockReason: 1 } } : { $set: { status } };
	const { matchedCount } = await Workspace.updateOne({ _id: id }, update);
	if (!matchedCount) return { error: "Workspace not found" };
	await recordAudit({ actor: session, workspaceId: id, action: status === "suspended" ? "workspace.suspended" : "workspace.resumed" });
	revalidatePath("/", "layout");
	return { ok: true };
}

// Gives a workspace a sending domain, including one that already exists in the sending service. This is
// configuration, not the inside of the workspace: the platform owner can set a client up without being let in.
export async function assignDomain(_state, formData) {
	const session = await requirePlatformAdmin();
	const id = readText(formData, "id");
	if (!isValidObjectId(id)) return { error: "Workspace not found" };
	await connectDb();
	if (!(await Workspace.exists({ _id: id }))) return { error: "Workspace not found" };

	const result = await addWorkspaceDomain({ workspaceId: id, userId: session.userId, input: readText(formData, "domain"), isPlatformAdmin: true });
	if (result.ok) {
		await recordAudit({ actor: session, workspaceId: id, action: "workspace.domain", detail: { domain: result.domain } });
		revalidatePath("/platform", "layout");
	}
	return result;
}

// --- The platform team: the accounts that run the platform ---

export async function invitePlatformTeamMember(_state, formData) {
	const session = await requirePlatformAdmin();
	const result = await invitePlatformAdmin({ inviter: session, email: readText(formData, "email") });
	if (result.ok) revalidatePath("/platform/team");
	return result;
}

export async function revokePlatformTeamInvitation(invitationId) {
	await requirePlatformAdmin();
	if (!isValidObjectId(invitationId)) return { error: "Invitation not found" };
	const result = await revokePlatformInvitation({ invitationId });
	revalidatePath("/platform/team");
	return result;
}

// Takes administrator rights from a person. Removing your own works too, as long as someone else remains.
export async function removePlatformTeamMember(userId) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(userId)) return { error: "This person is not a platform administrator" };
	const result = await removePlatformAdmin({ actor: session, userId });
	revalidatePath("/", "layout");
	return result;
}

// --- Accounts: every login on the platform ---

async function runAccountAction(userId, run) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(userId)) return { error: "Account not found" };
	const result = await run(session);
	revalidatePath("/platform/accounts");
	return result;
}

export async function setAccountDisabledAction(userId, disabled) {
	return runAccountAction(userId, (actor) => setAccountDisabled({ actor, userId, disabled: Boolean(disabled) }));
}

export async function signOutAccountAction(userId) {
	return runAccountAction(userId, (actor) => signOutAccount({ actor, userId }));
}

export async function sendAccountResetAction(userId) {
	return runAccountAction(userId, (actor) => sendAccountReset({ actor, userId }));
}

// For someone who lost their phone and their recovery codes: they are signed out everywhere and set it up again.
export async function resetAccountTwoFactorAction(userId) {
	return runAccountAction(userId, (actor) => resetTwoFactor({ actor, userId }));
}

// --- Issues the automatic scan flagged ---

// Approve or turn down the exact text that was flagged. The sender is told either way.
export async function decideReviewAction(campaignId, decision, note) {
	const session = await requirePlatformAdmin();
	if (!isValidObjectId(campaignId)) return { error: "This issue isn't waiting for review anymore" };
	const result = await decideReview({ actor: session, campaignId, decision, note });
	revalidatePath("/platform", "layout");
	return result;
}

// --- How fast a workspace may send ---

// Trusted: no warm-up and no daily amount (a client who arrives with a proven list). Or a daily amount of your own.
export async function updateSendingAction(_state, formData) {
	const session = await requirePlatformAdmin();
	const id = readText(formData, "id");
	if (!isValidObjectId(id)) return { error: "Workspace not found" };
	const capText = readText(formData, "dailyCap").replaceAll(",", "");
	if (capText && !/^[1-9]\d{0,8}$/.test(capText)) return { error: "The daily amount is a whole number, or empty to follow the warm-up" };
	const isTrusted = formData.get("isTrusted") === "on";

	await connectDb();
	const update = { $set: { "sendingTrust.isTrusted": isTrusted }, ...(capText ? {} : { $unset: { "sendingTrust.dailyCap": 1 } }) };
	if (capText) update.$set["sendingTrust.dailyCap"] = Number(capText);
	const { matchedCount } = await Workspace.updateOne({ _id: id }, update);
	if (!matchedCount) return { error: "Workspace not found" };
	await recordAudit({ actor: session, workspaceId: id, action: "workspace.sending", detail: { isTrusted, dailyCap: capText ? Number(capText) : null } });
	revalidatePath("/platform", "layout");
	return { ok: true };
}

// --- Domains the platform refuses at signup and import ---

export async function addBlockedDomainAction(_state, formData) {
	const session = await requirePlatformAdmin();
	const domain = String(normalizeDomain(readText(formData, "domain")) ?? "");
	const problem = getDomainProblem(domain);
	if (problem) return { error: problem };
	await connectDb();
	try {
		await BlockedDomain.create({ domain, reason: readText(formData, "reason").slice(0, 200), addedBy: session.userId });
	} catch (error) {
		if (error?.code === 11000) return { error: `${domain} is already blocked` };
		throw error;
	}
	clearAddressCaches();
	await recordAudit({ actor: session, action: "blocklist.added", detail: { domain } });
	revalidatePath("/platform/domains");
	return { ok: true, domain };
}

export async function removeBlockedDomainAction(domain) {
	const session = await requirePlatformAdmin();
	await connectDb();
	const { deletedCount } = await BlockedDomain.deleteOne({ domain: String(domain ?? "").toLowerCase() });
	if (!deletedCount) return { error: "That domain isn't blocked" };
	clearAddressCaches();
	await recordAudit({ actor: session, action: "blocklist.removed", detail: { domain } });
	revalidatePath("/platform/domains");
	return { ok: true };
}
