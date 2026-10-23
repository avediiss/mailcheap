import { NextResponse, after } from "next/server";
import { sendAlert } from "@/lib/alerts";
import { authenticateRequest } from "@/lib/api-keys";
import { isSendingEnabled } from "@/lib/config";
import { AddressError } from "@/lib/address-check";
import { upsertContact } from "@/lib/contacts";
import { QuotaError } from "@/lib/quota";
import { normalizeTags } from "@/lib/csv-import";
import { connectDb } from "@/lib/db";
import { getInbox } from "@/lib/inbox-links";
import { toFirstName } from "@/lib/merge-tags";
import { isRateLimited } from "@/lib/rate-limit";
import { queueConfirmationEmail } from "@/lib/sending";
import { queueWelcomeAndSeries } from "@/lib/sequence-jobs";
import { notifyNewSubscriber } from "@/lib/signup-notice";
import { isPlainObject, normalizeEmail } from "@/lib/validation";
import Newsletter from "@/models/Newsletter";

const MAX_SOURCE_LENGTH = 100;
// Each signup can send a welcome email, so a leaked key or a form without its own limit must not be
// able to flood the list. Sites that pass their visitor's IP get the archive form's per-visitor limit.
const PER_KEY = { name: "api-contacts-key", limit: 600, window: "1 h" };
const PER_VISITOR = { name: "api-contacts-ip", limit: 5, window: "10 m" };
const IP_PATTERN = /^[0-9a-f.:]{3,45}$/i;

function fail(status, error) {
	return NextResponse.json({ error }, { status });
}

function readInput(body) {
	if (!isPlainObject(body)) return { error: "Send a JSON object" };
	const { newsletter, email, source, resubscribe, ip, firstName, tags } = body;
	if (typeof newsletter !== "string" || !newsletter.trim()) return { error: "newsletter is required" };

	const normalizedEmail = normalizeEmail(email);
	if (!normalizedEmail) return { error: "email is invalid" };
	if (source !== undefined && (typeof source !== "string" || source.length > MAX_SOURCE_LENGTH)) {
		return { error: `source must be a string of at most ${MAX_SOURCE_LENGTH} characters` };
	}
	if (resubscribe !== undefined && typeof resubscribe !== "boolean") {
		return { error: "resubscribe must be a boolean" };
	}
	if (firstName !== undefined && typeof firstName !== "string") return { error: "firstName must be a string" };
	if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) {
		return { error: "tags must be an array of strings" };
	}
	return {
		slug: newsletter.trim().toLowerCase(),
		email: normalizedEmail,
		source: source?.trim() || "api",
		resubscribe: resubscribe === true,
		ip: typeof ip === "string" && IP_PATTERN.test(ip) ? ip : null,
		// A full name is fine: only the first word is kept, for {{first_name}}.
		firstName: toFirstName(firstName) || undefined,
		tags: normalizeTags(tags),
	};
}

export async function POST(request) {
	const apiKey = await authenticateRequest(request);
	if (!apiKey) return fail(401, "Invalid API key");
	if (!apiKey.isWorkspaceActive) return fail(403, "This workspace is suspended");

	const input = readInput(await request.json().catch(() => null));
	if (input.error) return fail(400, input.error);

	const keyId = String(apiKey._id);
	if (await isRateLimited({ ...PER_KEY, key: keyId })) {
		await sendAlert({
			key: `api-signup-flood:${keyId}`,
			title: "API signups paused",
			detail: `The "${apiKey.name}" key sent over ${PER_KEY.limit} signups in an hour. New ones are refused until it slows down. If that isn't your site, revoke the key.`,
			path: "/api-keys",
		});
		return fail(429, "Too many signups, try again later");
	}
	if (input.ip && (await isRateLimited({ ...PER_VISITOR, key: `${keyId}:${input.ip}` }))) {
		return fail(429, "Too many signups from this visitor, try again later");
	}

	await connectDb();
	// Only this key's workspace: another workspace's newsletter answers "not found", exactly like a slug that doesn't exist.
	const newsletter = await Newsletter.findOne({ slug: input.slug, workspaceId: apiKey.workspaceId }).lean();
	if (!newsletter) return fail(404, "Newsletter not found");

	let outcome;
	try {
		outcome = await upsertContact({
			newsletter,
			email: input.email,
			source: input.source,
			resubscribe: input.resubscribe,
			firstName: input.firstName,
			tags: input.tags,
		});
	} catch (error) {
		if (error instanceof QuotaError) return fail(403, error.message);
		if (error instanceof AddressError) {
			return NextResponse.json({ error: error.message, reason: error.reason, ...(error.suggestion && { suggestion: error.suggestion }) }, { status: 422 });
		}
		throw error;
	}
	const { contact, created } = outcome;
	if (created) after(() => notifyNewSubscriber({ newsletter, contact }));
	// A pending contact who signs up again gets the confirmation again (throttled per address).
	const isPending = contact.status === "pending";
	if (isSendingEnabled() && (isPending || (created && contact.status === "active"))) {
		const queue = isPending ? queueConfirmationEmail : queueWelcomeAndSeries;
		after(() =>
			queue({ newsletter, contact }).catch((error) =>
				console.error(`[api/contacts] Signup email for ${contact._id} failed:`, error.message)
			)
		);
	}

	return NextResponse.json(
		{
			id: String(contact._id),
			status: contact.status,
			created,
			// For the site's "check your inbox" message.
			...(isPending && { inbox: getInbox({ email: contact.email, fromEmail: newsletter.fromEmail }) }),
		},
		{ status: created ? 201 : 200 }
	);
}
