import "server-only";
import { buildAudienceQuery } from "@/lib/audience";
import { MESSAGE_STATS_GROUP } from "@/lib/message-stats";
import { buildNonOpenersFilter } from "@/lib/non-openers";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import Message from "@/models/Message";

const MAX_OPTIONS = 50;

// How many active contacts a campaign reaches with its "To" setting. Like the editor's count before
// segments, it doesn't subtract suppressed addresses: the send itself skips those.
export async function countAudience(campaign) {
	const onlyContactIds = campaign.audience?.nonOpenersOf
		? await Message.distinct("contactId", buildNonOpenersFilter(campaign.audience.nonOpenersOf, campaign.workspaceId))
		: undefined;
	const { filter } = buildAudienceQuery({
		workspaceId: campaign.workspaceId,
		newsletterId: campaign.newsletterId,
		segment: campaign.audience,
		onlyContactIds,
	});
	return Contact.countDocuments(filter);
}

// The tags and signup sources the "To" menu offers, with how many active contacts each has.
export async function getSegmentOptions(workspaceId, newsletterId) {
	const match = { $match: { workspaceId, newsletterId, status: "active" } };
	const top = [{ $sort: { count: -1, _id: 1 } }, { $limit: MAX_OPTIONS }];
	const [tags, sources] = await Promise.all([
		Contact.aggregate([match, { $unwind: "$tags" }, { $group: { _id: "$tags", count: { $sum: 1 } } }, ...top]),
		Contact.aggregate([
			match,
			{ $match: { source: { $type: "string", $ne: "" } } },
			{ $group: { _id: "$source", count: { $sum: 1 } } },
			...top,
		]),
	]);
	const toOption = ({ _id, count }) => ({ value: _id, count });
	return { tags: tags.map(toOption), sources: sources.map(toOption) };
}

export async function getResendOrigin(campaign) {
	if (!campaign.audience?.nonOpenersOf) return null;
	const origin = await Campaign.findOne({ _id: campaign.audience.nonOpenersOf, workspaceId: campaign.workspaceId }).select({ subject: 1 }).lean();
	return origin ? { id: String(origin._id), subject: origin.subject } : null;
}

// A/B results: the first-subject and second-subject halves, counted while the test ran (before a winner
// was picked, because later sends all carry the winner).
export async function getVariantRows(campaign) {
	const rows = await Message.aggregate([
		{
			$match: {
				campaignId: campaign._id,
				kind: "campaign",
				variant: { $exists: true },
				...(campaign.abWinnerAt && { createdAt: { $lt: campaign.abWinnerAt } }),
			},
		},
		{ $group: { _id: "$variant", ...MESSAGE_STATS_GROUP } },
	]);
	return rows.map(({ _id, ...row }) => ({ variant: _id, ...row }));
}
