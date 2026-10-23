import "server-only";
import { Client } from "@upstash/qstash";
import { sendAlert } from "@/lib/alerts";
import { assertReviewed } from "@/lib/content-review";
import { assignArchiveSlug } from "@/lib/archive-slugs";
import { assignVariant, isAbTest, withVariantSubject } from "@/lib/ab-test";
import { buildAudienceQuery, hasRestrictedAudience } from "@/lib/audience";
import { CLEANUP_FIELDS, addToPreview, emptyPreview, getCleanupSettings, splitAudience } from "@/lib/cleanup";
import { LIMITS, getAppUrl, isSendingEnabled } from "@/lib/config";
import { getConfirmUrl } from "@/lib/confirmation";
import { getConfirmationContent } from "@/lib/confirmation-content";
import { loadFieldKeys } from "@/lib/contact-fields-server";
import { connectDb } from "@/lib/db";
import { getKeepUrl } from "@/lib/last-chance";
import { getLastChanceContent } from "@/lib/last-chance-content";
import { buildNonOpenersFilter } from "@/lib/non-openers";
import { mailboxProvider } from "@/lib/providers";
import { arrangeWaves, describeSendPlan, describeWarmupLimit, getMaxRecipients, scheduleBatches, secondsUntilNextUtcDay } from "@/lib/send-plan";
import { findNeverEmailed, loadSendState } from "@/lib/send-plan-server";
import { assertEmailRoom, loadEmailBudgets } from "@/lib/quota";
import { getSequenceContent } from "@/lib/sequence";
import { sendSesEmail } from "@/lib/ses";
import {
	CAMPAIGN_MESSAGE_KINDS,
	MAX_BATCH_MESSAGES,
	MAX_CONSECUTIVE_FAILURES,
	SEND_BATCH_SIZE,
	TEST_CONTACT_ID,
	buildRecipientEmail,
	chunk,
	getCampaignPauseReason,
	getCampaignStatsPath,
	getFeedbackId,
	getNextStepLimit,
	getSendErrorAction,
	getSendProblem,
	getWelcomeContent,
} from "@/lib/sending-rules";
import { isObjectIdString, normalizeEmail } from "@/lib/validation";
import { evaluateWorkspaceHealth } from "@/lib/workspace-health-server";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";
import Domain from "@/models/Domain";
import Suppression from "@/models/Suppression";
import Workspace from "@/models/Workspace";
import { buildSuppressionIndex, getSendGateProblem, isSuppressedFor, suppressionFilter } from "@/lib/workspace-rules";

export { buildRecipientEmail } from "@/lib/sending-rules";

const QUEUEABLE_STATUSES = ["draft", "scheduled", "paused"];
const INSERT_CHUNK_SIZE = 1000;
const PUBLISH_CHUNK_SIZE = 100;
const SEND_INTERVAL_MS = Math.ceil(1000 / LIMITS.sendRatePerSecond);
const WELCOME_WINDOW_MS = 10 * 60 * 1000;
const SIGNUP_KINDS = ["welcome", "confirmation"];
// Their links have to work, so they go out clean: no tracking pixel or redirect.
const UNTRACKED_KINDS = new Set(["confirmation", "last-chance"]);
// Signing up again resends the confirmation, but a script can't make us mail an address over and over.
const MAX_CONFIRMATIONS_PER_CONTACT = 3;

let qstash;
let nextSendAt = 0;

function assertSendingEnabled() {
	if (!isSendingEnabled()) throw new Error("Sending is off");
}

export function getQStash() {
	if (!process.env.QSTASH_TOKEN) throw new Error("QStash is not configured (QSTASH_TOKEN)");
	qstash ??= new Client({ token: process.env.QSTASH_TOKEN });
	return qstash;
}

function formatError(error) {
	return String(error?.message || error).slice(0, 500);
}

// Slots are reserved synchronously, so concurrent sends in one instance share the rate.
async function waitForSendSlot() {
	const now = Date.now();
	const sendAt = Math.max(now, nextSendAt);
	nextSendAt = sendAt + SEND_INTERVAL_MS;
	if (sendAt > now) await new Promise((resolve) => setTimeout(resolve, sendAt - now));
}

function getMessageTags(message) {
	const tags = [
		{ name: "message_id", value: String(message._id) },
		{ name: "kind", value: message.kind },
	];
	if (message.campaignId) tags.push({ name: "campaign_id", value: String(message.campaignId) });
	return tags;
}

async function deliver({ message, content, newsletter, contact, fieldKeys }) {
	const reference = { contactId: contact._id, newsletterId: newsletter._id };
	const email = buildRecipientEmail({
		campaign: content,
		newsletter,
		contact,
		messageId: UNTRACKED_KINDS.has(message.kind) ? null : message._id,
		confirmUrl: message.kind === "confirmation" ? getConfirmUrl(reference) : "",
		keepUrl: message.kind === "last-chance" ? getKeepUrl(reference) : "",
		fieldKeys,
	});
	const feedbackId = getFeedbackId({
		campaignId: message.campaignId,
		kind: message.kind,
		newsletterSlug: newsletter.slug,
	});
	await waitForSendSlot();
	const { sesMessageId } = await sendSesEmail({
		...email,
		headers: { ...email.headers, "Feedback-ID": feedbackId },
		tags: getMessageTags(message),
	});
	return { sesMessageId, sentAt: new Date() };
}

function getMessageContent({ kind, newsletter, campaign, message }) {
	if (kind === "welcome") return getWelcomeContent(newsletter);
	if (kind === "confirmation") return newsletter ? getConfirmationContent(newsletter) : null;
	if (kind === "last-chance") return newsletter ? getLastChanceContent(newsletter) : null;
	if (kind === "sequence") return newsletter ? getSequenceContent(newsletter, message?.step) : null;
	// An A/B test sends the second subject to its half.
	return kind === "campaign" ? withVariantSubject(campaign, message?.variant) : campaign;
}

// The friendly version of the batch sender's check: refuse to queue a campaign that could never go out.
async function assertWorkspaceMaySend(workspaceId, newsletter) {
	const [workspace, domainRows] = await Promise.all([
		Workspace.findById(workspaceId).select({ status: 1 }).lean(),
		Domain.find({ workspaceId }).select({ domain: 1 }).lean(),
	]);
	const problem = getSendGateProblem({
		workspace,
		domains: domainRows.map(({ domain }) => domain),
		fromEmail: newsletter?.fromEmail,
	});
	if (problem) throw new Error(problem);
}

// Welcome and confirmation emails share one cap per newsletter, so a signup flood can't burn its sending
// domain's reputation, and a flood on one newsletter doesn't hold up the others' signup emails.
function countRecentSignupEmails(newsletter) {
	return Message.countDocuments({
		kind: { $in: SIGNUP_KINDS },
		newsletterId: newsletter._id,
		createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
	});
}

async function alertSignupCap(newsletter) {
	await sendAlert({
		key: `welcome-cap:${newsletter.slug}`,
		title: "Signup emails capped",
		detail: `Over ${LIMITS.welcomeEmailsPer10Minutes} welcome and confirmation emails for ${newsletter.name} in 10 minutes. New signups get none until it slows down.`,
		path: "/contacts",
	});
}

async function findByIds(Model, ids) {
	const uniqueIds = [...new Set(ids.filter(Boolean).map(String))];
	if (uniqueIds.length === 0) return new Map();
	const documents = await Model.find({ _id: { $in: uniqueIds } }).lean();
	return new Map(documents.map((document) => [String(document._id), document]));
}

async function pauseCampaign(campaignId, reason) {
	const campaign = await Campaign.findOneAndUpdate(
		{ _id: campaignId, status: "sending" },
		{ $set: { status: "paused" } }
	)
		.select({ workspaceId: 1 })
		.lean();
	if (!campaign) return;
	// The workspace's owners need to know, and so do you: a paused send is often a reputation problem.
	await sendAlert({
		audience: "owners+platform",
		workspaceId: campaign.workspaceId,
		key: `campaign-paused-${campaignId}`,
		title: "Campaign paused",
		detail: reason,
		path: `/campaigns/${campaignId}`,
		cooldownMinutes: 1,
	});
}

async function pauseIfUnhealthy(campaignId) {
	const campaign = await Campaign.findOne({ _id: campaignId, status: "sending" })
		.select("stats lastChance")
		.lean();
	const reason = campaign ? getCampaignPauseReason(campaign.stats, campaign.lastChance) : null;
	if (reason) await pauseCampaign(campaignId, `${reason} is over the limit`);
	return Boolean(reason);
}

async function settleCampaign(campaignId) {
	if (await pauseIfUnhealthy(campaignId)) return;
	if (await Message.exists({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: "queued" })) return;
	// A campaign sent in steps keeps the date of its first step.
	await Campaign.updateOne({ _id: campaignId, status: "sending" }, { $set: { status: "sent" }, $min: { sentAt: new Date() } });
}

async function insertIgnoringDuplicates(messages) {
	if (messages.length === 0) return;
	try {
		await Message.insertMany(messages, { ordered: false });
	} catch (error) {
		// Mongoose copies the driver's WriteErrors, which keeps the code on `err`.
		const codes = (error?.writeErrors ?? []).map(({ err, code }) => err?.code ?? code);
		const isOnlyDuplicates =
			codes.length > 0 ? codes.every((code) => code === 11000) : error?.code === 11000;
		if (!isOnlyDuplicates) throw error;
	}
}

async function* inChunks(items, size) {
	let pending = [];
	for await (const item of items) {
		pending.push(item);
		if (pending.length === size) {
			yield pending;
			pending = [];
		}
	}
	if (pending.length > 0) yield pending;
}

// An A/B test marks each issue with its subject (lib/ab-test.js), alternating from where the last step stopped.
function toMessages(campaign, kind, contacts, variantOffset = 0) {
	return contacts.map((contact, index) => {
		const variant = kind === "campaign" ? assignVariant({ campaign, index, offset: variantOffset }) : null;
		return {
			kind,
			workspaceId: campaign.workspaceId,
			campaignId: campaign._id,
			newsletterId: campaign.newsletterId,
			contactId: contact._id,
			email: contact.email,
			provider: mailboxProvider(contact.email),
			...(variant && { variant }),
		};
	});
}

// The list cleanup only applies to a send to the whole list.
function getSendSettings(campaign, newsletter) {
	const settings = getCleanupSettings(newsletter);
	return hasRestrictedAudience(campaign.audience) ? { ...settings, enabled: false } : settings;
}

// Contacts this campaign already reached: an earlier step, or an attempt that stopped halfway.
async function findPreviousMessages(campaignId) {
	const messages = await Message.find({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS } })
		.select({ _id: 0, contactId: 1, kind: 1 })
		.lean();
	return new Map(messages.map(({ contactId, kind }) => [String(contactId), kind]));
}

// Active, unsuppressed contacts, most engaged first. With the list cleanup on, the limit counts issue
// recipients only, so it's applied while walking (lib/cleanup.js splitAudience).
async function buildCampaignAudience(campaign, audienceLimit) {
	const suppressedEmails = await Suppression.distinct("email", suppressionFilter(campaign.workspaceId));
	const onlyContactIds = campaign.audience?.nonOpenersOf
		? await Message.distinct("contactId", buildNonOpenersFilter(campaign.audience.nonOpenersOf, campaign.workspaceId))
		: undefined;
	return buildAudienceQuery({
		workspaceId: campaign.workspaceId,
		newsletterId: campaign.newsletterId,
		suppressedEmails,
		audienceLimit,
		segment: campaign.audience,
		onlyContactIds,
	});
}

// How many issue emails a send would make, before any are queued: the contacts it reaches, up to its cap.
// The workspace's monthly allowance is checked against this.
async function estimateRecipients(campaign, audienceLimit) {
	const { filter, limit } = await buildCampaignAudience(campaign, audienceLimit);
	const count = await Contact.countDocuments(filter);
	return limit ? Math.min(count, limit) : count;
}

async function findAudience({ campaign, settings, audienceLimit }) {
	const { filter, sort, limit } = await buildCampaignAudience(campaign, audienceLimit);
	const query = Contact.find(filter).sort(sort).select(settings.enabled ? CLEANUP_FIELDS : { email: 1 }).lean();
	if (limit && !settings.enabled) query.limit(limit);
	const previous = settings.enabled ? await findPreviousMessages(campaign._id) : new Map();
	return { contacts: query.cursor(), limit, previous };
}

async function makeDormant(campaignId, contacts) {
	if (contacts.length === 0) return;
	// A sign of life since the walk read them sets ignoredIssues back to 0: those contacts stay.
	const { modifiedCount } = await Contact.updateMany(
		{ _id: { $in: contacts.map(({ _id }) => _id) }, status: "active", ignoredIssues: { $gt: 0 } },
		{ $set: { status: "dormant" } }
	);
	if (modifiedCount > 0) {
		await Campaign.updateOne({ _id: campaignId }, { $inc: { "lastChance.dormant": modifiedCount } });
	}
}

async function insertCampaignMessages(campaign, newsletter) {
	const settings = getSendSettings(campaign, newsletter);
	const { contacts, limit, previous } = await findAudience({ campaign, settings, audienceLimit: campaign.audienceLimit });
	const now = Date.now();
	let remaining = limit ?? Infinity;
	let variantOffset = isAbTest(campaign) ? await Message.countDocuments({ campaignId: campaign._id, kind: "campaign" }) : 0;
	for await (const group of inChunks(contacts, INSERT_CHUNK_SIZE)) {
		const split = splitAudience(group, { settings, limit: remaining, previous, now });
		await insertIgnoringDuplicates(toMessages(campaign, "campaign", split.issue, variantOffset));
		variantOffset += split.issue.length;
		await insertIgnoringDuplicates(toMessages(campaign, "last-chance", split.lastChance));
		await makeDormant(campaign._id, split.dormant);
		remaining -= split.issue.length + split.received;
		if (remaining <= 0) break;
	}
}

// What the list cleanup would do at this send, for the send dialogs: one walk over the whole list.
export async function getCleanupPreview(campaignId) {
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");
	await connectDb();
	const campaign = await Campaign.findById(campaignId).select({ newsletterId: 1, audience: 1 }).lean();
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await Newsletter.findById(campaign.newsletterId).select({ slug: 1, cleanup: 1 }).lean();
	const settings = getSendSettings(campaign, newsletter);
	if (!settings.enabled) return { enabled: false };

	const { contacts, previous } = await findAudience({ campaign, settings });
	const preview = emptyPreview();
	const now = Date.now();
	for await (const group of inChunks(contacts, INSERT_CHUNK_SIZE)) addToPreview(preview, group, { settings, previous, now });
	return { enabled: true, ...preview };
}

function countCampaignMessages(campaignId) {
	return Promise.all(CAMPAIGN_MESSAGE_KINDS.map((kind) => Message.countDocuments({ campaignId, kind })));
}

// The one-per-campaign pacing QStash applies to the batches of a send.
function getFlowControl(campaignId) {
	return {
		key: `campaign-${campaignId}`,
		parallelism: 1,
		rate: 1,
		period: `${Math.ceil(SEND_BATCH_SIZE / LIMITS.sendRatePerSecond)}s`,
	};
}

async function publishRequests(requests) {
	for (const group of chunk(requests, PUBLISH_CHUNK_SIZE)) await getQStash().batchJSON(group);
}

// Issues first, then last-chance emails to the least engaged addresses. A new sender's emails go out in the
// amounts it is allowed per day, and a send to many people who have never had an email from the workspace sends
// a slice first and the rest 3 hours later (lib/send-plan.js): each batch is published with the delay it needs.
async function publishQueuedMessages(campaignId) {
	const campaign = await Campaign.findById(campaignId).select({ workspaceId: 1 }).lean();
	const queued = await Message.find({ campaignId, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: "queued" })
		.sort({ kind: 1, _id: 1 })
		.select({ _id: 1, kind: 1, contactId: 1 })
		.lean();
	const now = new Date();
	const [state, never] = await Promise.all([
		loadSendState(campaign.workspaceId, { now }),
		findNeverEmailed(queued.filter(({ kind }) => kind === "campaign").map(({ contactId }) => contactId)),
	]);
	const { first, second, slice } = arrangeWaves(queued.map(({ _id, kind, contactId }) => ({ id: String(_id), kind, isNew: never.has(String(contactId)) })));
	const url = `${getAppUrl()}/api/jobs/send-batch`;
	const flowControl = getFlowControl(campaignId);
	const requests = scheduleBatches({ first, second, size: SEND_BATCH_SIZE, cap: state.cap, sentToday: state.sentToday, now }).map(({ ids, delay }) => ({
		url,
		body: { messageIds: ids },
		flowControl,
		...(delay > 0 && { delay }),
	}));
	await publishRequests(requests);
	const notes = describeSendPlan({ total: queued.length, cap: state.cap, sentToday: state.sentToday, slice });
	return { batches: requests.length, notes };
}

// Emails a workspace may not send today are put back for the next UTC day.
async function deferMessages(deferred) {
	if (deferred.length === 0) return;
	const url = `${getAppUrl()}/api/jobs/send-batch`;
	const delay = secondsUntilNextUtcDay();
	const requests = [...Map.groupBy(deferred, ({ campaignId }) => campaignId)].flatMap(([campaignId, items]) =>
		chunk(items.map(({ id }) => id), SEND_BATCH_SIZE).map((messageIds) => ({ url, body: { messageIds }, delay, flowControl: getFlowControl(campaignId) }))
	);
	await publishRequests(requests);
}

// What a send would do, for the send dialogs: how many it reaches, how it is spread, who goes first.
export async function getSendPlanPreview(campaignId, { audienceLimit } = {}) {
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");
	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	const limit = audienceLimit ?? campaign.audienceLimit;
	const [state, audience, { filter }] = await Promise.all([loadSendState(campaign.workspaceId), estimateRecipients(campaign, limit), buildCampaignAudience(campaign, limit)]);
	const reached = Math.min(audience, getMaxRecipients(state));
	const newCount = await Contact.countDocuments({ ...filter, lastSentAt: null });
	const newInSend = Math.min(newCount, reached);
	const slice = newInSend > 0 ? arrangeWaves(Array.from({ length: newInSend }, () => ({ kind: "campaign", isNew: true }))).slice : null;
	return {
		notes: [describeWarmupLimit({ reached, audience, cap: state.cap }), ...describeSendPlan({ total: reached, cap: state.cap, sentToday: state.sentToday, slice })].filter(Boolean),
	};
}

// Draft or scheduled: selects the audience. Paused: resumes with the audience it already has.
export async function queueCampaign(campaignId) {
	assertSendingEnabled();
	if (!process.env.QSTASH_TOKEN) throw new Error("QStash is not configured (QSTASH_TOKEN)");
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	if (!QUEUEABLE_STATUSES.includes(campaign.status)) {
		throw new Error(`Campaign is already ${campaign.status}`);
	}
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);
	await assertWorkspaceMaySend(campaign.workspaceId, newsletter);
	// An issue that looks like phishing or a scam waits for a person at the platform before it goes out.
	await assertReviewed(campaign);
	// A new sender can only send so many a day, and a send reaches at most what the next three days allow:
	// the most engaged people first, the rest through "Send to more" later.
	const isResume = campaign.status === "paused";
	const state = await loadSendState(campaign.workspaceId);
	const maxRecipients = getMaxRecipients(state);
	const audienceLimit = !isResume && (!campaign.audienceLimit || campaign.audienceLimit > maxRecipients) && Number.isFinite(maxRecipients) ? maxRecipients : campaign.audienceLimit;
	// A send that can't fit in the month's allowance is refused now, not half-sent.
	const needed = isResume
		? await Message.countDocuments({ campaignId: campaign._id, kind: { $in: CAMPAIGN_MESSAGE_KINDS }, status: "queued" })
		: await estimateRecipients(campaign, audienceLimit);
	await assertEmailRoom({ workspaceId: campaign.workspaceId, needed });
	const limitNote = isResume || audienceLimit === campaign.audienceLimit
		? null
		: describeWarmupLimit({ reached: audienceLimit, audience: await estimateRecipients(campaign, campaign.audienceLimit), cap: state.cap });

	if (!isResume) await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients + lastChances === 0) throw new Error("No active contacts to send to");

	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaign._id, status: campaign.status },
		{
			$set: { status: "sending", "stats.recipients": recipients, "lastChance.recipients": lastChances, ...(audienceLimit && { audienceLimit }) },
			$min: { startedAt: new Date() },
		}
	);
	if (!modifiedCount) throw new Error("The campaign changed, refresh and try again");

	try {
		await assignArchiveSlug({ campaign, newsletter });
		const { batches, notes } = await publishQueuedMessages(campaign._id);
		const sendNotes = [limitNote, ...notes].filter(Boolean);
		if (!isResume) await Campaign.updateOne({ _id: campaign._id }, { $set: { sendNotes } });
		if (batches === 0) await settleCampaign(campaign._id);
		return { recipients, batches, notes: sendNotes };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the campaign, it is paused: ${formatError(error)}`);
	}
}

// Sending in steps: a sent campaign goes to the next most engaged contacts. It takes the top of the
// audience again and the one-email-per-contact index skips everyone who already received it.
export async function sendToMoreContacts(campaignId, additional) {
	assertSendingEnabled();
	if (!process.env.QSTASH_TOKEN) throw new Error("QStash is not configured (QSTASH_TOKEN)");
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	if (campaign.status !== "sent") throw new Error("Wait until the current step has gone out");
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const problem = getSendProblem({ campaign, newsletter });
	if (problem) throw new Error(problem);
	await assertWorkspaceMaySend(campaign.workspaceId, newsletter);

	const [sentSoFar, lastChancesSoFar] = await countCampaignMessages(campaign._id);
	// The next step is held to what the daily allowance lets out over the next few days, like the first.
	const state = await loadSendState(campaign.workspaceId);
	const stepLimit = getNextStepLimit({ sentSoFar, additional });
	const allowedLimit = sentSoFar + getMaxRecipients(state);
	const audienceLimit = Number.isFinite(allowedLimit) && (!stepLimit || stepLimit > allowedLimit) ? allowedLimit : stepLimit;
	const reachable = await estimateRecipients(campaign, audienceLimit);
	await assertEmailRoom({ workspaceId: campaign.workspaceId, needed: Math.max(0, reachable - sentSoFar) });
	await insertCampaignMessages({ ...campaign, audienceLimit }, newsletter);
	const [recipients, lastChances] = await countCampaignMessages(campaign._id);
	if (recipients === sentSoFar && lastChances === lastChancesSoFar) throw new Error("Everyone has received it already");

	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaign._id, status: "sent" },
		{
			$set: {
				status: "sending",
				"stats.recipients": recipients,
				"lastChance.recipients": lastChances,
				...(audienceLimit && { audienceLimit }),
			},
			...(!audienceLimit && { $unset: { audienceLimit: 1 } }),
		}
	);
	if (!modifiedCount) throw new Error("The campaign changed, refresh and try again");

	try {
		const { batches, notes } = await publishQueuedMessages(campaign._id);
		if (batches === 0) await settleCampaign(campaign._id);
		return { added: recipients - sentSoFar, recipients, batches, notes };
	} catch (error) {
		await pauseCampaign(campaign._id, `queueing failed: ${formatError(error)}`);
		throw new Error(`Could not queue the next step, the campaign is paused: ${formatError(error)}`);
	}
}

// Every issue counts toward the list cleanup until a sign of life sets the count back (lib/cleanup.js).
async function recordSent({ message, campaign, contact, sesMessageId, sentAt }) {
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { sesMessageId, sentAt }, $unset: { error: 1 } }
	);
	const statsPath = getCampaignStatsPath(message.kind);
	await Promise.all([
		campaign && Campaign.updateOne({ _id: campaign._id }, { $inc: { [`${statsPath}.sent`]: 1 } }),
		Contact.updateOne(
			{ _id: contact._id },
			{
				$set: { lastSentAt: sentAt, ...(message.kind === "last-chance" && { lastChanceAt: sentAt }) },
				$inc: { "stats.sent": 1, ...(message.kind === "campaign" && { ignoredIssues: 1 }) },
			}
		),
	]);
}

async function recordFailed({ message, campaign, error }) {
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { status: "failed", error: formatError(error) } }
	);
	if (campaign) {
		await Campaign.updateOne({ _id: campaign._id }, { $inc: { [`${getCampaignStatsPath(message.kind)}.failed`]: 1 } });
	}
}

// At most once per message: the queued -> sent claim happens before SES is called.
export async function sendMessageBatch(messageIds) {
	assertSendingEnabled();
	const ids = [
		...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id).toLowerCase())),
	]
		.filter(isObjectIdString)
		.slice(0, MAX_BATCH_MESSAGES);
	const result = { sent: 0, failed: 0, suppressed: 0, skipped: 0, retry: false };
	if (ids.length === 0) return result;

	await connectDb();
	const order = new Map(ids.map((id, index) => [id, index]));
	const messages = (
		await Message.find({
			_id: { $in: ids },
			status: "queued",
			kind: { $in: [...CAMPAIGN_MESSAGE_KINDS, ...SIGNUP_KINDS, "sequence"] },
		}).lean()
	).sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
	result.skipped = ids.length - messages.length;
	if (messages.length === 0) return result;

	const workspaceIds = [...new Set(messages.map(({ workspaceId }) => workspaceId).filter(Boolean).map(String))];
	const [campaigns, newsletters, contacts, suppressionRows, workspaces, domainRows] = await Promise.all([
		findByIds(Campaign, messages.map(({ campaignId }) => campaignId)),
		findByIds(Newsletter, messages.map(({ newsletterId }) => newsletterId)),
		findByIds(Contact, messages.map(({ contactId }) => contactId)),
		Suppression.find({ email: { $in: messages.map(({ email }) => email) } }).select({ email: 1, workspaceId: 1 }).lean(),
		findByIds(Workspace, workspaceIds),
		Domain.find({ workspaceId: { $in: workspaceIds } }).select({ workspaceId: 1, domain: 1 }).lean(),
	]);
	// A workspace past the account limits is blocked before this batch sends anything for it.
	for (const [workspaceId, workspace] of workspaces) {
		if (workspace.status === "active" && (await evaluateWorkspaceHealth(workspaceId))) workspace.status = "suspended";
	}
	const suppression = buildSuppressionIndex(suppressionRows);
	const domainsByWorkspace = Map.groupBy(domainRows, ({ workspaceId }) => String(workspaceId));
	// Each workspace's monthly allowance, counted once for the batch and kept up as emails go out.
	const budgets = await loadEmailBudgets(workspaces.values());
	// And its daily one: campaign emails over it wait for tomorrow instead of going out (lib/send-plan.js).
	const dailyBudgets = new Map();
	for (const workspaceId of workspaceIds) {
		const { cap, sentToday } = await loadSendState(workspaceId);
		dailyBudgets.set(workspaceId, { cap, used: sentToday });
	}
	const deferred = [];
	const fieldKeys = await loadFieldKeys(workspaceIds);
	for (const campaignId of campaigns.keys()) await pauseIfUnhealthy(campaignId);

	let consecutiveFailures = 0;
	for (const message of messages) {
		if (!isSendingEnabled()) {
			result.retry = true;
			break;
		}
		const campaign = campaigns.get(String(message.campaignId)) ?? null;
		const isCampaignSending =
			!CAMPAIGN_MESSAGE_KINDS.includes(message.kind) ||
			(await Campaign.exists({ _id: message.campaignId, status: "sending" }));
		if (!isCampaignSending) {
			result.skipped++;
			continue;
		}

		// A suspended workspace sends nothing, and each workspace sends only from its own domains.
		const gateProblem = getSendGateProblem({
			workspace: workspaces.get(String(message.workspaceId)),
			domains: (domainsByWorkspace.get(String(message.workspaceId)) ?? []).map(({ domain }) => domain),
			fromEmail: newsletters.get(String(message.newsletterId))?.fromEmail,
		});
		if (gateProblem) {
			if (campaign) {
				await pauseCampaign(campaign._id, gateProblem);
			} else {
				await Message.updateOne({ _id: message._id, status: "queued" }, { $set: { status: "failed", error: gateProblem } });
				result.failed++;
			}
			result.skipped++;
			continue;
		}

		const budget = budgets.get(String(message.workspaceId));
		if (budget && budget.used >= budget.limit) {
			const reason = "the monthly email limit is reached";
			if (campaign) {
				await pauseCampaign(campaign._id, reason);
			} else {
				await Message.updateOne({ _id: message._id, status: "queued" }, { $set: { status: "failed", error: `This workspace's ${reason}` } });
				result.failed++;
			}
			result.skipped++;
			continue;
		}

		const daily = dailyBudgets.get(String(message.workspaceId));
		if (daily && CAMPAIGN_MESSAGE_KINDS.includes(message.kind) && daily.used >= daily.cap) {
			deferred.push({ id: String(message._id), campaignId: String(message.campaignId) });
			result.skipped++;
			continue;
		}

		const contact = contacts.get(String(message.contactId));
		const requiredStatus = message.kind === "confirmation" ? "pending" : "active";
		if (contact?.status !== requiredStatus || isSuppressedFor(suppression, String(message.workspaceId), message.email)) {
			await Message.updateOne(
				{ _id: message._id, status: "queued" },
				{ $set: { status: "suppressed" } }
			);
			result.suppressed++;
			continue;
		}

		const claim = await Message.updateOne(
			{ _id: message._id, status: "queued" },
			{ $set: { status: "sent", provider: mailboxProvider(message.email) } }
		);
		if (!claim.modifiedCount) {
			result.skipped++;
			continue;
		}

		const newsletter = newsletters.get(String(message.newsletterId));
		const content = getMessageContent({ kind: message.kind, newsletter, campaign, message });
		let delivery;
		try {
			if (!newsletter || !content) throw new Error("Newsletter or email content not found");
			delivery = await deliver({ message, content, newsletter, contact, fieldKeys: fieldKeys.get(String(message.workspaceId)) });
		} catch (error) {
			const action = campaign ? getSendErrorAction(error) : "fail";
			if (action === "fail") {
				await recordFailed({ message, campaign, error });
				result.failed++;
				consecutiveFailures++;
				if (!campaign || consecutiveFailures < MAX_CONSECUTIVE_FAILURES) continue;
				await pauseCampaign(campaign._id, `${consecutiveFailures} sends failed in a row`);
				break;
			}
			await Message.updateOne({ _id: message._id, status: "sent" }, { $set: { status: "queued" } });
			if (action === "pause") await pauseCampaign(campaign._id, formatError(error));
			else result.retry = true;
			break;
		}

		await recordSent({ message, campaign, contact, ...delivery });
		if (budget) budget.used++;
		if (daily) daily.used++;
		result.sent++;
		consecutiveFailures = 0;
	}

	// Put back for the next day. If that can't be queued the error stands, so QStash retries the batch.
	await deferMessages(deferred);
	for (const campaignId of campaigns.keys()) await settleCampaign(campaignId);
	return result;
}

async function sendTest({ content, newsletter, campaignId, to }) {
	const email = normalizeEmail(to);
	if (!email) throw new Error("The test email address is invalid");
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) throw new Error(problem);
	await assertWorkspaceMaySend(newsletter.workspaceId, newsletter);

	// A test shows the name the address has on the list, so {{first_name}} can be checked.
	const known = await Contact.findOne({ newsletterId: newsletter._id, email }).select({ firstName: 1, fields: 1 }).lean();
	const message = await Message.create({
		kind: "test",
		workspaceId: newsletter.workspaceId,
		campaignId,
		newsletterId: newsletter._id,
		email,
		provider: mailboxProvider(email),
	});
	let delivery;
	try {
		delivery = await deliver({
			message,
			content: { ...content, subject: `[Test] ${content.subject}` },
			newsletter,
			contact: { _id: TEST_CONTACT_ID, email, firstName: known?.firstName, fields: known?.fields },
			fieldKeys: (await loadFieldKeys([newsletter.workspaceId])).get(String(newsletter.workspaceId)),
		});
	} catch (error) {
		await recordFailed({ message, campaign: null, error });
		throw error;
	}

	const { sesMessageId, sentAt } = delivery;
	await Message.updateOne({ _id: message._id }, { $set: { status: "sent", sesMessageId, sentAt } });
	return { messageId: String(message._id), sesMessageId, sentAt };
}

export async function sendTestEmail({ campaignId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(campaignId))) throw new Error("Campaign not found");

	await connectDb();
	const campaign = await Campaign.findById(campaignId).lean();
	if (!campaign) throw new Error("Campaign not found");
	const newsletter = await Newsletter.findById(campaign.newsletterId).lean();
	const result = await sendTest({ content: campaign, newsletter, campaignId: campaign._id, to });
	await Campaign.updateOne({ _id: campaign._id }, { $set: { testSentAt: result.sentAt } });
	return result;
}

// Sends the saved welcome email, whether or not it's switched on yet.
export async function sendWelcomeTestEmail({ newsletterId, to }) {
	assertSendingEnabled();
	if (!isObjectIdString(String(newsletterId))) throw new Error("Newsletter not found");

	await connectDb();
	const newsletter = await Newsletter.findById(newsletterId).lean();
	if (!newsletter) throw new Error("Newsletter not found");
	const content = getWelcomeContent({ welcome: { ...newsletter.welcome, enabled: true } });
	if (!content) throw new Error("Save a subject and content first");
	return sendTest({ content, newsletter, to });
}

export async function queueWelcomeEmail({ newsletter, contact }) {
	assertSendingEnabled();
	const content = getWelcomeContent(newsletter);
	if (!content) return { skipped: "welcome email is off" };
	if (contact?.status !== "active") return { skipped: "contact is not active" };

	await connectDb();
	const [isSuppressed, hasWelcome, recentWelcomes] = await Promise.all([
		Suppression.exists({ email: contact.email, ...suppressionFilter(newsletter.workspaceId) }),
		Message.exists({ kind: "welcome", contactId: contact._id }),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (hasWelcome) return { skipped: "already sent" };
	if (recentWelcomes >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) {
		console.warn(`[sending] Welcome email for ${newsletter.slug} not sent: ${problem}`);
		return { skipped: problem };
	}
	return sendSignupEmail({ kind: "welcome", newsletter, contact });
}

export async function queueConfirmationEmail({ newsletter, contact }) {
	assertSendingEnabled();
	if (contact?.status !== "pending") return { skipped: "contact is not pending" };

	await connectDb();
	const [isSuppressed, sentToContact, sentRecently, recentSignupEmails] = await Promise.all([
		Suppression.exists({ email: contact.email, ...suppressionFilter(newsletter.workspaceId) }),
		Message.countDocuments({ kind: "confirmation", contactId: contact._id }),
		Message.exists({
			kind: "confirmation",
			contactId: contact._id,
			createdAt: { $gte: new Date(Date.now() - WELCOME_WINDOW_MS) },
		}),
		countRecentSignupEmails(newsletter),
	]);
	if (isSuppressed) return { skipped: "suppressed" };
	if (sentRecently || sentToContact >= MAX_CONFIRMATIONS_PER_CONTACT) return { skipped: "already sent" };
	if (recentSignupEmails >= LIMITS.welcomeEmailsPer10Minutes) {
		await alertSignupCap(newsletter);
		return { skipped: "rate limited" };
	}
	return sendSignupEmail({ kind: "confirmation", newsletter, contact });
}

async function sendSignupEmail({ kind, newsletter, contact }) {
	const message = await Message.create({
		kind,
		workspaceId: newsletter.workspaceId,
		newsletterId: newsletter._id,
		contactId: contact._id,
		email: contact.email,
		provider: mailboxProvider(contact.email),
	});
	return { messageId: String(message._id), ...(await sendMessageBatch([String(message._id)])) };
}

// One welcome-series email (lib/sequence-jobs.js). The message is created first: the one-per-step index
// makes a retried job find it instead of sending again, and a message still queued is sent now.
export async function sendSequenceEmail({ newsletter, contact, step }) {
	assertSendingEnabled();
	const content = getSequenceContent(newsletter, step);
	if (!content) return { skipped: "step is off" };
	const problem = getSendProblem({ campaign: content, newsletter });
	if (problem) {
		console.warn(`[sending] Series email ${step + 1} for ${newsletter.slug} not sent: ${problem}`);
		return { skipped: problem };
	}

	await connectDb();
	let message;
	try {
		message = await Message.create({
			kind: "sequence",
			step,
			workspaceId: newsletter.workspaceId,
			newsletterId: newsletter._id,
			contactId: contact._id,
			email: contact.email,
			provider: mailboxProvider(contact.email),
		});
	} catch (error) {
		if (error?.code !== 11000) throw error;
		message = await Message.findOne({ kind: "sequence", contactId: contact._id, step });
		if (message?.status !== "queued") return { skipped: "already sent" };
	}
	return { messageId: String(message._id), ...(await sendMessageBatch([String(message._id)])) };
}
