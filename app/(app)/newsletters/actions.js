"use server";

import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateArchive } from "@/lib/archive-data";
import { CLEANUP_LIMITS } from "@/lib/cleanup";
import { isSendingEnabled } from "@/lib/config";
import { getConfirmationProblem } from "@/lib/confirmation-content";
import { connectDb } from "@/lib/db";
import { MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH } from "@/lib/newsletters";
import { sendWelcomeTestEmail } from "@/lib/sending";
import { getSequenceProblem, normalizeSteps } from "@/lib/sequence";
import { parseSocialLinks } from "@/lib/social";
import { clearArchiveHostCache } from "@/lib/archive-host-lookup";
import { getArchiveHostProblem, parseArchiveHosts } from "@/lib/archive-hosts";
import { sendAlert } from "@/lib/alerts";
import { getAppUrl } from "@/lib/config";
import { normalizeDomain } from "@/lib/domain-rules";
import { listWorkspaceDomains, requireWorkspace } from "@/lib/workspace";
import { getLimitProblem, isSenderAllowed } from "@/lib/workspace-rules";
import Newsletter from "@/models/Newsletter";
import Workspace from "@/models/Workspace";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_URL_PATTERN = /^(https:\/\/[^\s"'<>]{4,490}|\/[\w\-./]{1,200})$/;

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// Empty stays unset, so the newsletter's default applies.
function readNumber(formData, key) {
	const text = readText(formData, key);
	return text ? Number(text) : undefined;
}

function isWithin(value, min, max) {
	return value === undefined || (Number.isInteger(value) && value >= min && value <= max);
}

// The series form repeats its fields once per email: row n is the n-th value of each.
function readSequenceRows(formData) {
	const [delays, subjects, previews, markdowns] = ["Delay", "Subject", "Preview", "Markdown"].map((field) =>
		formData.getAll(`sequence${field}`).map(String)
	);
	return subjects.map((subject, index) => ({
		delayDays: delays[index],
		subject,
		previewText: previews[index],
		markdown: markdowns[index],
	}));
}

function readNewsletter(formData) {
	return {
		name: readText(formData, "name"),
		slug: readText(formData, "slug").toLowerCase(),
		imageUrl: readText(formData, "imageUrl"),
		fromName: readText(formData, "fromName"),
		fromEmail: readText(formData, "fromEmail").toLowerCase(),
		replyTo: readText(formData, "replyTo").toLowerCase(),
		postalAddress: readText(formData, "postalAddress"),
		archiveEnabled: formData.get("archiveEnabled") === "on",
		archiveHost: normalizeDomain(readText(formData, "archiveHost")) ?? "",
		description: readText(formData, "description"),
		author: { bio: readText(formData, "authorBio"), imageUrl: readText(formData, "authorImageUrl") },
		socialLinks: parseSocialLinks(formData.get("socialLinks")),
		requireConfirmation: formData.get("requireConfirmation") === "on",
		notifyOnSignup: formData.get("notifyOnSignup") === "on",
		cleanup: {
			enabled: formData.get("cleanupEnabled") === "on",
			issues: readNumber(formData, "cleanupIssues"),
			days: readNumber(formData, "cleanupDays"),
		},
		welcome: {
			enabled: formData.get("welcomeEnabled") === "on",
			subject: readText(formData, "welcomeSubject"),
			previewText: readText(formData, "welcomePreviewText"),
			markdown: String(formData.get("welcomeMarkdown") ?? ""),
		},
		sequence: { enabled: formData.get("sequenceEnabled") === "on", rows: readSequenceRows(formData) },
		confirmation: {
			subject: readText(formData, "confirmationSubject"),
			previewText: readText(formData, "confirmationPreviewText"),
			markdown: String(formData.get("confirmationMarkdown") ?? ""),
		},
	};
}

function validateNewsletter(values) {
	if (!values.name) return "Name is required";
	if (!SLUG_PATTERN.test(values.slug)) return "Slug can only use lowercase letters, numbers and dashes";
	if (values.imageUrl && !IMAGE_URL_PATTERN.test(values.imageUrl)) {
		return "Image must be an https:// link or a path like /logos/name.webp";
	}
	if (!EMAIL_PATTERN.test(values.fromEmail)) return "From email is invalid";
	if (values.replyTo && !EMAIL_PATTERN.test(values.replyTo)) return "Reply-to email is invalid";
	if (values.description.length > MAX_DESCRIPTION_LENGTH) {
		return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`;
	}
	if (values.author.bio.length > MAX_AUTHOR_BIO_LENGTH) {
		return `Keep the author bio under ${MAX_AUTHOR_BIO_LENGTH} characters`;
	}
	if (values.author.imageUrl && !IMAGE_URL_PATTERN.test(values.author.imageUrl)) {
		return "Author photo must be an https:// link or a path like /authors/name.jpg";
	}
	if (values.socialLinks.error) return values.socialLinks.error;
	const { minIssues, maxIssues, minDays, maxDays } = CLEANUP_LIMITS;
	if (!isWithin(values.cleanup.issues, minIssues, maxIssues)) {
		return `Ignored issues should be a whole number from ${minIssues} to ${maxIssues}`;
	}
	if (!isWithin(values.cleanup.days, minDays, maxDays)) {
		return `Quiet days should be a whole number from ${minDays} to ${maxDays}`;
	}
	if (values.welcome.enabled && (!values.welcome.subject || !values.welcome.markdown.trim())) {
		return "Welcome email needs a subject and content";
	}
	const sequenceProblem = getSequenceProblem(values.sequence.rows);
	if (sequenceProblem) return sequenceProblem;
	return values.requireConfirmation ? getConfirmationProblem(values.confirmation) : null;
}

// Sending errors become toasts; a thrown error would replace the page with the error boundary.
export async function sendWelcomeTest(newsletterId) {
	const { workspaceId, session, isSuspended } = await requireWorkspace();
	if (!isSendingEnabled()) return { error: "Sending is off" };
	if (isSuspended) return { error: "This workspace is suspended" };
	if (!isValidObjectId(newsletterId)) return { error: "Newsletter not found" };
	await connectDb();
	if (!(await Newsletter.exists({ _id: newsletterId, workspaceId }))) return { error: "Newsletter not found" };
	try {
		await sendWelcomeTestEmail({ newsletterId, to: session.email });
		return { ok: true };
	} catch (error) {
		console.error("[newsletters] Welcome test failed:", error);
		return { error: error.message || "Sending failed" };
	}
}

export async function saveNewsletter(_state, formData) {
	const { workspaceId } = await requireWorkspace();
	const id = readText(formData, "id");
	if (id && !isValidObjectId(id)) return { error: "Newsletter not found" };
	// First thing: another workspace's id is "not found" whatever else is wrong with the form.
	if (id) {
		await connectDb();
		if (!(await Newsletter.exists({ _id: id, workspaceId }))) return { error: "Newsletter not found" };
	}

	const values = readNewsletter(formData);
	const error = validateNewsletter(values);
	if (error) return { error };
	const archiveHostProblem = getArchiveHostProblem(values.archiveHost, new URL(getAppUrl()).hostname);
	if (archiveHostProblem) return { error: archiveHostProblem };
	// A domain in the ARCHIVE_HOSTS environment variable belongs to the newsletter it names there.
	const envOwner = parseArchiveHosts(process.env.ARCHIVE_HOSTS).get(values.archiveHost);
	if (values.archiveHost && envOwner && envOwner !== values.slug) return { error: "This domain already serves another newsletter's archive." };
	// Each workspace sends only from its own domains, even though they all share one SES account.
	const domains = await listWorkspaceDomains(workspaceId);
	if (!isSenderAllowed(domains, values.fromEmail)) {
		return {
			error: domains.length
				? `From email must be on one of your domains: ${domains.join(", ")}`
				: "Add a sending domain to this workspace before choosing a from email",
		};
	}
	// A collapsed email section sends no fields, and what it had saved stays as it is.
	const { welcome, confirmation, sequence, ...rest } = values;
	const { archiveHost, ...fields } = rest;
	const document = {
		...fields,
		...(archiveHost && { archiveHost }),
		socialLinks: values.socialLinks.links,
		...(formData.has("welcomeSubject") && { welcome }),
		...(formData.has("confirmationSubject") && { confirmation }),
		...(formData.has("sequenceShown") && { sequence: { enabled: sequence.enabled, steps: normalizeSteps(sequence.rows) } }),
	};

	await connectDb();
	let createdId;
	try {
		if (id) {
			const { matchedCount } = await Newsletter.updateOne(
				{ _id: id, workspaceId },
				{ $set: document, ...(!archiveHost && { $unset: { archiveHost: 1 } }) },
				{ runValidators: true }
			);
			if (!matchedCount) return { error: "Newsletter not found" };
		} else {
			const workspace = await Workspace.findById(workspaceId).select({ limits: 1 }).lean();
			const limitProblem = getLimitProblem({
				limit: workspace?.limits?.newsletters,
				current: await Newsletter.countDocuments({ workspaceId }),
				noun: "newsletters",
			});
			if (limitProblem) return { error: limitProblem };
			createdId = (await Newsletter.create({ ...document, workspaceId }))._id.toString();
		}
	} catch (error) {
		if (error?.code === 11000) {
			return { error: String(error.message).includes("archiveHost") ? "This domain already serves another archive." : "This slug is already used" };
		}
		throw error;
	}
	if (archiveHost) {
		clearArchiveHostCache();
		// Pointing the domain at this app is the platform owner's step on the hosting side.
		await sendAlert({
			key: `archive-host:${values.slug}:${archiveHost}`,
			title: "Archive domain set",
			detail: `${archiveHost} now serves the archive of "${values.name}". Point it at this app and attach it in your hosting panel if you haven't.`,
			path: "/newsletters",
			cooldownMinutes: 1,
		});
	}

	revalidatePath("/newsletters");
	revalidateArchive();
	if (createdId) redirect(`/newsletters/${createdId}`);
	return { ok: true, savedAt: Date.now() };
}
