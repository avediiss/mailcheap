import "server-only";
import { sendAlert } from "@/lib/alerts";
import { recordAudit } from "@/lib/audit";
import { scanContent } from "@/lib/content-scan";
import { contentHash } from "@/lib/content-hash";
import { connectDb } from "@/lib/db";
import Campaign from "@/models/Campaign";
import Newsletter from "@/models/Newsletter";
import Workspace from "@/models/Workspace";

export class ReviewError extends Error {
	constructor(message) {
		super(message);
		this.name = "ReviewError";
	}
}

export const campaignBody = (campaign) => (campaign.format === "markdown" ? campaign.markdown : campaign.html) ?? "";

// The automatic scan, and the review a flagged issue then needs. Throws ReviewError when the issue can't go out
// yet: waiting for a person, or turned down. An issue the scan doesn't flag is not touched.
export async function assertReviewed(campaign) {
	const parts = { subject: campaign.subject ?? "", previewText: campaign.previewText ?? "", body: campaignBody(campaign) };
	const scan = scanContent(parts);
	if (scan.risk !== "high") return;

	const hash = contentHash(parts);
	const { review } = campaign;
	if (review?.hash === hash) {
		if (review.status === "approved") return;
		if (review.status === "rejected") {
			throw new ReviewError(`The platform team looked at this issue and can't send it${review.note ? `: ${review.note}` : "."} Change it and try again.`);
		}
		throw new ReviewError("This issue is waiting for a quick review by the platform team before it can go out. You'll get an email as soon as it's decided.");
	}

	await connectDb();
	await Campaign.updateOne(
		{ _id: campaign._id },
		{ $set: { review: { status: "pending", hash, reasons: scan.reasons, requestedAt: new Date() } } }
	);
	await sendAlert({
		audience: "platform",
		key: `review-${campaign._id}-${hash.slice(0, 8)}`,
		title: "Issue waiting for review",
		detail: `"${parts.subject}" was flagged: ${scan.reasons.join("; ")}.`,
		path: "/platform/review",
		cooldownMinutes: 1,
	});
	throw new ReviewError("This issue needs a quick review by the platform team before it can go out, because it looks like it could be a phishing or scam email. You'll get an email as soon as it's decided.");
}

// Welcome, confirmation and series emails are not reviewed one by one: one that trips the scan is refused when
// the newsletter is saved, with the reason, so there is never a hidden email waiting.
export function getContentProblem({ label, subject, body }) {
	const scan = scanContent({ subject, body });
	return scan.risk === "high" ? `${label}: ${scan.reasons[0]}. It can't be used as it is. If this is a mistake, contact the platform team.` : null;
}

export async function listPendingReviews() {
	await connectDb();
	const campaigns = await Campaign.find({ "review.status": "pending", status: { $in: ["draft", "scheduled", "paused"] } })
		.sort({ "review.requestedAt": 1 })
		.lean();
	const [newsletters, workspaces] = await Promise.all([
		Newsletter.find({ _id: { $in: campaigns.map(({ newsletterId }) => newsletterId) } }).select({ name: 1 }).lean(),
		Workspace.find({ _id: { $in: campaigns.map(({ workspaceId }) => workspaceId) } }).select({ name: 1 }).lean(),
	]);
	const newsletterNames = new Map(newsletters.map(({ _id, name }) => [String(_id), name]));
	const workspaceNames = new Map(workspaces.map(({ _id, name }) => [String(_id), name]));
	return campaigns.map((campaign) => ({
		id: String(campaign._id),
		workspaceId: String(campaign.workspaceId),
		workspaceName: workspaceNames.get(String(campaign.workspaceId)) ?? "A workspace",
		newsletterName: newsletterNames.get(String(campaign.newsletterId)) ?? "A newsletter",
		subject: campaign.subject,
		previewText: campaign.previewText,
		body: campaignBody(campaign),
		reasons: campaign.review.reasons ?? [],
		requestedAt: campaign.review.requestedAt,
	}));
}

// Approves or turns down the text that was flagged. Only a still-pending request for the same text is decided,
// so an edit made while it waited sends the issue back through the scan instead.
export async function decideReview({ actor, campaignId, decision, note }) {
	if (!["approved", "rejected"].includes(decision)) return { error: "Unknown decision" };
	await connectDb();
	const campaign = await Campaign.findOne({ _id: campaignId, "review.status": "pending" }).lean();
	if (!campaign) return { error: "This issue isn't waiting for review anymore" };
	const hash = contentHash({ subject: campaign.subject ?? "", previewText: campaign.previewText ?? "", body: campaignBody(campaign) });
	if (hash !== campaign.review.hash) return { error: "The issue was edited since it was flagged. It will be scanned again when it is sent." };
	const reason = String(note ?? "").trim().slice(0, 500);
	if (decision === "rejected" && !reason) return { error: "Say why, so the sender can fix it" };

	const { modifiedCount } = await Campaign.updateOne(
		{ _id: campaign._id, "review.status": "pending", "review.hash": hash },
		{ $set: { "review.status": decision, "review.decidedAt": new Date(), "review.decidedBy": actor.userId, "review.note": reason } }
	);
	if (!modifiedCount) return { error: "This issue isn't waiting for review anymore" };
	await recordAudit({ actor, workspaceId: campaign.workspaceId, action: decision === "approved" ? "review.approved" : "review.rejected", detail: { subject: campaign.subject, note: reason } });
	await sendAlert({
		audience: "owners",
		workspaceId: campaign.workspaceId,
		key: `review-decided-${campaign._id}-${decision}`,
		title: decision === "approved" ? "Your issue was approved" : "Your issue wasn't approved",
		detail: decision === "approved" ? `"${campaign.subject}" can be sent now.` : `"${campaign.subject}" can't be sent as it is: ${reason}`,
		path: `/campaigns/${campaign._id}`,
		cooldownMinutes: 1,
	});
	return { ok: true };
}
