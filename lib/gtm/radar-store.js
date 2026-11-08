import "server-only";
import { connectDb } from "@/lib/db";
import { GTM_LIMITS } from "@/lib/gtm/config";
import GtmOpportunity from "@/models/gtm/Opportunity";
import GtmWatchedSource from "@/models/gtm/WatchedSource";

// What the radar remembers between scans: how far it has read, and which posts it has already seen. The
// scan runs every three hours forever, so both answers have to survive a restart, a redeploy and a founder
// who was away for a week.

// Where the next scan starts. A source that has never been read looks back a bounded window rather than at
// everything ever posted: the archive is enormous, almost all of it is stale, and scoring is charged per
// post.
export function scanWindowStart({ lastScanAt, now = new Date(), firstRunHours = GTM_LIMITS.radarFirstRunHours }) {
	if (lastScanAt) return new Date(lastScanAt);
	return new Date(now.getTime() - firstRunHours * 60 * 60 * 1000);
}

// The text arrives from a stranger on the internet, so it is cut to what the schema allows before being
// written rather than after Mongo complains: bulkWrite does not run Mongoose's validators.
function clamp(value, max) {
	return String(value ?? "")
		.trim()
		.slice(0, max);
}

// Saves what a scan found. A post the radar has seen before is updated, never duplicated and never reset:
// its score, its reason and above all its status belong to the founder, who may already have skipped it.
// Only what the platform can legitimately change — the text of an edited comment, its context — is written
// again.
export async function saveCandidates({ workspaceId, productId, candidates = [] }) {
	if (candidates.length === 0) return { created: 0, updated: 0, total: 0 };
	await connectDb();

	const operations = candidates.map((candidate) => ({
		updateOne: {
			filter: { productId, externalId: clamp(candidate.externalId, 300) },
			update: {
				$set: {
					url: clamp(candidate.url, 2000),
					author: clamp(candidate.author, 200),
					text: clamp(candidate.text, 20_000),
					postedAt: candidate.postedAt,
					keywords: (candidate.keywords ?? []).map((keyword) => clamp(keyword, 80)).filter(Boolean),
					contextTitle: clamp(candidate.contextTitle ?? candidate.storyTitle, 500),
					contextUrl: clamp(candidate.contextUrl ?? candidate.storyUrl, 2000),
				},
				// Written once and then left alone. "status" is the founder's: a skipped post coming back
				// as new on the next scan would be the radar arguing with them every three hours.
				$setOnInsert: { workspaceId, platform: candidate.platform, status: "new" },
			},
			upsert: true,
		},
	}));

	// Unordered: one post failing to write should not stop the rest of the scan being saved.
	const result = await GtmOpportunity.bulkWrite(operations, { ordered: false });
	return {
		created: result.upsertedCount ?? 0,
		updated: result.modifiedCount ?? 0,
		total: candidates.length,
	};
}

// Moves a source's watermark forward after a scan that worked. On a failure the watermark stays where it
// is: advancing it would quietly skip the window the failed scan was meant to cover, and nobody would ever
// know which posts were lost.
export async function markSourceScanned({ sourceId, at = new Date(), error = null }) {
	await connectDb();
	const update = error ? { lastError: clamp(error, 300) } : { lastScanAt: at, lastError: null };
	await GtmWatchedSource.updateOne({ _id: sourceId }, { $set: update });
	return update;
}

// Which of these posts the radar has already stored. Asked about the ids in hand rather than loading the
// whole table: a product that has been running for a year has thousands of rows and a scan has fifty.
export async function knownExternalIds({ productId, externalIds = [] }) {
	if (externalIds.length === 0) return new Set();
	await connectDb();
	const rows = await GtmOpportunity.find({ productId, externalId: { $in: externalIds } })
		.select("externalId")
		.lean();
	return new Set(rows.map((row) => row.externalId));
}

// What the scorer decided, written onto rows that already exist. Separate from saving the posts, so a
// scoring failure leaves them stored and unscored instead of losing them: the queue shows an unscored post
// and the next scan can try again.
export async function saveScores({ productId, scores = [] }) {
	if (scores.length === 0) return { updated: 0 };
	await connectDb();

	const operations = scores.map(({ externalId, score, reason }) => ({
		updateOne: {
			filter: { productId, externalId },
			update: { $set: { score, reason: String(reason ?? "").slice(0, 500) } },
		},
	}));

	const result = await GtmOpportunity.bulkWrite(operations, { ordered: false });
	return { updated: result.modifiedCount ?? 0 };
}

// The founder's queue: unhandled posts, best first. Unscored posts sort last rather than being hidden —
// a post the scorer could not reach is still a post, and leaving it invisible would make a failed batch
// look like a quiet day.
export async function listOpportunities({ productId, status = "new", limit = 50 }) {
	await connectDb();
	return GtmOpportunity.find({ productId, status })
		.sort({ score: -1, postedAt: -1 })
		.limit(Math.min(Math.max(limit, 1), 200))
		.lean();
}

// What the founder decided. Scoped by product as well as id, so one workspace can never move another's
// row by guessing an id.
export async function setOpportunityStatus({ productId, opportunityId, status }) {
	await connectDb();
	const result = await GtmOpportunity.updateOne({ _id: opportunityId, productId }, { $set: { status } });
	return { changed: result.matchedCount > 0 };
}

// The sources a scan should read: active, belonging to this product, and on a platform the radar can
// actually read today. Reddit and X rows are stored from onboarding but skipped until their week comes.
export async function listScannableSources({ productId, platforms = ["hn"] }) {
	await connectDb();
	return GtmWatchedSource.find({ productId, active: true, platform: { $in: platforms } }).lean();
}
