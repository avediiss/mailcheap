import "server-only";
import { isValidObjectId } from "mongoose";
import { listContactFields } from "@/lib/contact-fields-server";
import { connectDb } from "@/lib/db";
import { buildSegmentFilter } from "@/lib/segments";
import Contact from "@/models/Contact";
import Segment from "@/models/Segment";

export class SegmentMissingError extends Error {
	constructor() {
		super("The segment chosen for this issue was deleted. Choose who it goes to again.");
		this.name = "SegmentMissingError";
	}
}

const toPlain = (segment) => ({ id: String(segment._id), name: segment.name, match: segment.match, conditions: segment.conditions.map(({ field, op, value }) => ({ field, op, ...(value !== undefined && { value }) })) });

// A newsletter's saved segments, oldest first.
export async function listSegments({ workspaceId, newsletterId }) {
	await connectDb();
	const rows = await Segment.find({ workspaceId, newsletterId }).sort({ createdAt: 1 }).lean();
	return rows.map(toPlain);
}

export async function getSegment({ workspaceId, segmentId }) {
	if (!isValidObjectId(segmentId)) return null;
	await connectDb();
	const row = await Segment.findOne({ _id: segmentId, workspaceId }).lean();
	return row ? { ...toPlain(row), newsletterId: String(row.newsletterId) } : null;
}

// Active contacts the rules pick out of one newsletter, now.
export function countRules({ workspaceId, newsletterId, segment }) {
	return Contact.countDocuments({ workspaceId, newsletterId, status: "active", ...buildSegmentFilter(segment) });
}

// Each segment with how many active contacts are in it, for the cards and the "To" menu.
export async function listSegmentsWithCounts({ workspaceId, newsletterId }) {
	const segments = await listSegments({ workspaceId, newsletterId });
	return Promise.all(segments.map(async (segment) => ({ ...segment, count: await countRules({ workspaceId, newsletterId, segment }) })));
}

// The filter a campaign's saved segment adds to its audience, or {} when it has none. Throws when the segment it
// points at no longer exists: an issue must never go to everyone because a segment was deleted.
export async function getSegmentFilterFor(campaign) {
	const segmentId = campaign.audience?.segmentId;
	if (!segmentId) return {};
	await connectDb();
	const segment = await Segment.findOne({ _id: segmentId, workspaceId: campaign.workspaceId, newsletterId: campaign.newsletterId }).lean();
	if (!segment) throw new SegmentMissingError();
	return buildSegmentFilter(segment);
}

export { listContactFields };
