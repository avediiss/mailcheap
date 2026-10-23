import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import CampaignReport from "@/components/CampaignReport";
import FormCampaign from "@/components/FormCampaign";
import { getAbVerdict, isAbTest, summarizeVariants } from "@/lib/ab-test";
import { getArchiveUrls } from "@/lib/archive-hosts";
import { listContactFields } from "@/lib/contact-fields-server";
import { countAudience, getResendOrigin, getSegmentOptions, getVariantRows } from "@/lib/campaign-audience";
import { sendTimesPipeline } from "@/lib/campaign-queries";
import { isSendingEnabled } from "@/lib/config";
import { connectDb } from "@/lib/db";
import { MESSAGE_STATS_GROUP } from "@/lib/message-stats";
import { serialize } from "@/lib/serialize";
import { listSesDomains } from "@/lib/ses";
import { listWorkspaceDomains, requireWorkspace } from "@/lib/workspace";
import { isSenderAllowed } from "@/lib/workspace-rules";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";
import Newsletter from "@/models/Newsletter";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }) {
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();

	const { workspaceId, session } = await requireWorkspace();
	await connectDb();
	// Found only inside the signed-in person's workspace: another workspace's campaign is a 404.
	const campaign = await Campaign.findOne({ _id: id, workspaceId }).lean();
	if (!campaign) notFound();
	const newsletter = await Newsletter.findOne({ _id: campaign.newsletterId, workspaceId }).lean();
	if (!newsletter) notFound();

	if (!["draft", "scheduled"].includes(campaign.status)) {
		const [providers, remainingCount, resendOrigin, variantRows] = await Promise.all([
			getProviderBreakdown(campaign._id),
			countRemaining(campaign),
			getResendOrigin(campaign),
			isAbTest(campaign) ? getVariantRows(campaign) : [],
		]);
		const variants = isAbTest(campaign) ? summarizeVariants(variantRows) : null;
		return (
			<CampaignReport
				campaign={serialize(campaign)}
				newsletter={serialize(newsletter)}
				providers={providers}
				remainingCount={remainingCount}
				resendOrigin={resendOrigin}
				variants={variants}
				verdict={variants ? getAbVerdict(variants) : null}
			/>
		);
	}

	const [audienceCount, domains, ownDomains, sendTimes, segmentOptions, resendOrigin] = await Promise.all([
		countAudience(campaign),
		listSesDomains(),
		listWorkspaceDomains(workspaceId),
		getSendTimes(campaign),
		getSegmentOptions(workspaceId, newsletter._id),
		getResendOrigin(campaign),
	]);
	const fromDomain = newsletter.fromEmail.split("@")[1];
	// Verified in SES, and one of this workspace's own domains.
	const isDomainVerified =
		isSenderAllowed(ownDomains, newsletter.fromEmail) &&
		Array.isArray(domains) &&
		domains.some(({ domain, verified }) => domain === fromDomain && verified);

	return (
		<FormCampaign
			fieldKeys={(await listContactFields(workspaceId)).map(({ key }) => key)}
			campaign={serialize(campaign)}
			newsletter={serialize(newsletter)}
			audienceCount={audienceCount}
			segmentOptions={segmentOptions}
			resendOrigin={resendOrigin}
			isDomainVerified={isDomainVerified}
			isSendingEnabled={isSendingEnabled()}
			testEmail={session.email}
			sendTimes={sendTimes}
			archiveUrlBase={newsletter.archiveEnabled ? getArchiveUrls(newsletter).absolutePost("") : null}
		/>
	);
}

// A newsletter's first issue borrows the times the other newsletters go out.
async function getSendTimes(campaign) {
	const { workspaceId } = campaign;
	const own = await Campaign.aggregate(
		sendTimesPipeline({ workspaceId, newsletterId: campaign.newsletterId, excludeId: campaign._id })
	);
	// A first issue borrows the times of this workspace's other newsletters, never another workspace's.
	const rows = own.length > 0 ? own : await Campaign.aggregate(sendTimesPipeline({ workspaceId, excludeId: campaign._id }));
	return {
		history: rows.map(({ at }) => at.toISOString()),
		taken: own.filter(({ status }) => status === "scheduled").map(({ at }) => at.toISOString()),
	};
}

// Only a send capped to the most engaged has a next step. Close enough for the dialog: contacts who
// left after receiving it make this a little low, and the send itself skips everyone who has it.
async function countRemaining(campaign) {
	if (campaign.status !== "sent" || !campaign.audienceLimit) return 0;
	const active = await countAudience(campaign);
	const reached = (campaign.stats?.recipients ?? 0) + (campaign.lastChance?.recipients ?? 0);
	return Math.max(0, active - reached);
}

async function getProviderBreakdown(campaignId) {
	const rows = await Message.aggregate([
		{ $match: { campaignId, kind: "campaign" } },
		{ $group: { _id: { $ifNull: ["$provider", "other"] }, ...MESSAGE_STATS_GROUP } },
		{ $sort: { sent: -1 } },
	]);
	return rows.filter(({ sent }) => sent > 0).map(({ _id, ...row }) => ({ provider: _id, ...row }));
}
