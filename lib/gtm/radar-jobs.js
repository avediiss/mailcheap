import "server-only";
import { connectDb } from "@/lib/db";
import { askForJson } from "@/lib/gtm/ai";
import { GTM_LIMITS, isGtmAiConfigured, isGtmEnabled, isGtmRedditConfigured } from "@/lib/gtm/config";
import { fromProductFields } from "@/lib/gtm/profile";
import { filterCandidates } from "@/lib/gtm/radar-filter";
import { scoreCandidates } from "@/lib/gtm/radar-score";
import {
	knownExternalIds,
	listScannableSources,
	listUnscored,
	markSourceScanned,
	saveCandidates,
	saveScores,
	scanWindowStart,
} from "@/lib/gtm/radar-store";
import { searchBluesky } from "@/lib/gtm/sources/bluesky";
import { searchHn } from "@/lib/gtm/sources/hn";
import { searchReddit } from "@/lib/gtm/sources/reddit";
import GtmProduct from "@/models/gtm/Product";

// What the scheduled scan does when QStash delivers it, every three hours: for each product that finished
// onboarding, read what is new on the platforms it watches, throw away what no model needs to see, score
// what is left, and leave the result in the founder's queue.
//
// The shape of the whole thing is that nothing here is allowed to fail the scan. A platform that is down,
// a subreddit that is private, a scoring batch that comes back malformed — each costs its own piece and
// nothing else. The schedule runs again in three hours regardless.

// Which platforms can be read at all right now. Reddit needs an approved app; without one its sources are
// skipped rather than attempted and failed.
function readablePlatforms() {
	return isGtmRedditConfigured() ? ["hn", "bluesky", "reddit"] : ["hn", "bluesky"];
}

// The founder's own accounts, so the radar never offers them their own post. A watched source is a place
// to look; one that names a person names the founder.
function ownAuthors(sources) {
	return sources
		.map(({ platform, identifier }) => {
			const name = String(identifier ?? "");
			if (platform === "hn") return name.startsWith("user/") ? name.slice(5) : "";
			if (platform === "reddit") return name.startsWith("u/") ? name.slice(2) : "";
			if (platform === "bluesky") return name.startsWith("profile/") ? name.slice(8) : "";
			// An X source is always a handle, never a room.
			return platform === "x" ? name : "";
		})
		.filter(Boolean);
}

// A source naming a person — a Hacker News user, a Bluesky profile — is the founder's own account rather
// than a place to look. It is never searched; it only lets the radar recognise the founder's own posts.
function isPerson({ platform, identifier }) {
	const name = String(identifier ?? "");
	return (platform === "hn" && name.startsWith("user/")) || (platform === "bluesky" && name.startsWith("profile/"));
}

async function readSource({ source, keywords, now }) {
	const since = scanWindowStart({ lastScanAt: source.lastScanAt, now });

	if (source.platform === "reddit") {
		const { candidates, problems } = await searchReddit({ subreddits: [source.identifier], keywords, since });
		return { since, candidates, error: problems[0]?.error ?? null };
	}

	if (source.platform === "bluesky") {
		const { candidates, problems } = await searchBluesky({ keywords, since });
		return { since, candidates, error: problems[0]?.error ?? null };
	}

	const { candidates, problems } = await searchHn({ keywords, since });
	// Hacker News is searched as a whole, so a problem there is the platform's, not this source's.
	return { since, candidates, error: problems[0]?.error ?? null };
}

async function scanProduct({ product, now, scoreLimit }) {
	const keywords = product.keywords ?? [];
	const sources = await listScannableSources({ productId: product._id, platforms: readablePlatforms() });
	if (keywords.length === 0 || sources.length === 0) {
		return { productId: String(product._id), found: 0, kept: 0, created: 0, scored: 0, problems: [] };
	}

	const problems = [];
	const found = new Map();

	for (const source of sources) {
		if (isPerson(source)) continue;
		const { candidates, error } = await readSource({ source, keywords, now });
		// A source that failed keeps its watermark, so the next scan covers the window this one missed.
		await markSourceScanned({ sourceId: source._id, at: now, error });
		if (error) problems.push({ source: source.identifier, error });
		// What the keywords that worked found is kept even when another failed. Throwing it away would let
		// one keyword that always fails starve the whole platform; kept, it is stored now, and recognised as
		// already known when the unmoved watermark makes the next scan read the window again.
		for (const candidate of candidates) found.set(candidate.externalId, candidate);
	}

	const candidates = [...found.values()];
	const known = await knownExternalIds({
		productId: product._id,
		externalIds: candidates.map(({ externalId }) => externalId),
	});
	// No limit here: everything that passes the rules is saved. The cap is on what scoring may spend, not
	// on what is kept — the watermark has already moved past these posts, so one not saved now is a post
	// the founder never sees. Measured on a month of Bluesky, the single best post of 260 was outside the
	// first 80 the old cap kept.
	const { kept, counts } = filterCandidates({
		candidates,
		knownIds: known,
		ownAuthors: ownAuthors(sources),
		limit: Number.POSITIVE_INFINITY,
	});

	// Stored before they are scored, so a scoring failure leaves posts in the queue unscored rather than
	// losing them until someone notices.
	const { created } = await saveCandidates({ workspaceId: product.workspaceId, productId: product._id, candidates: kept });

	let scored = 0;
	if (isGtmAiConfigured()) {
		// The backlog includes what was just saved: posts beyond this scan's budget, or from a failed batch,
		// are scored by later scans instead of being forgotten.
		const backlog = await listUnscored({ productId: product._id, limit: scoreLimit });
		if (backlog.length > 0) {
			const result = await scoreCandidates({
				candidates: backlog,
				profile: fromProductFields(product),
				askForJson,
				workspaceId: product.workspaceId,
				productId: product._id,
			});
			await saveScores({ productId: product._id, scores: result.scored });
			scored = result.scored.length;
			for (const problem of result.problems) problems.push({ source: "scoring", error: problem.error });
		}
	}

	return { productId: String(product._id), found: candidates.length, kept: kept.length, created, scored, dropped: counts, problems };
}

export async function runRadarScan({ now = new Date(), scoreLimit = GTM_LIMITS.maxScoredPerScan } = {}) {
	// A handled outcome, not a failure: the schedule can stay in place while the module is switched off,
	// and QStash must not retry it.
	if (!isGtmEnabled()) return { skipped: "the GTM agent is off" };

	await connectDb();
	const products = await GtmProduct.find({ onboardingStatus: "ready" }).lean();

	const results = [];
	for (const product of products) {
		// One founder's scan failing outright must not stop the others being scanned.
		try {
			results.push(await scanProduct({ product, now, scoreLimit }));
		} catch (error) {
			console.error(`[gtm radar] product ${product._id} failed:`, error.message);
			results.push({ productId: String(product._id), failed: error.message });
		}
	}

	return {
		ran: true,
		at: now.toISOString(),
		products: products.length,
		created: results.reduce((total, result) => total + (result.created ?? 0), 0),
		scored: results.reduce((total, result) => total + (result.scored ?? 0), 0),
		results,
	};
}
