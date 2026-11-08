import "server-only";
import { connectDb } from "@/lib/db";
import { askForJson } from "@/lib/gtm/ai";
import { isGtmAiConfigured, isGtmEnabled, isGtmRedditConfigured } from "@/lib/gtm/config";
import { fromProductFields } from "@/lib/gtm/profile";
import { filterCandidates } from "@/lib/gtm/radar-filter";
import { scoreCandidates } from "@/lib/gtm/radar-score";
import {
	knownExternalIds,
	listScannableSources,
	markSourceScanned,
	saveCandidates,
	saveScores,
	scanWindowStart,
} from "@/lib/gtm/radar-store";
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
	return isGtmRedditConfigured() ? ["hn", "reddit"] : ["hn"];
}

// The founder's own accounts, so the radar never offers them their own post. A watched source is a place
// to look; one that names a person names the founder.
function ownAuthors(sources) {
	return sources
		.map(({ platform, identifier }) => {
			const name = String(identifier ?? "");
			if (platform === "hn") return name.startsWith("user/") ? name.slice(5) : "";
			if (platform === "reddit") return name.startsWith("u/") ? name.slice(2) : "";
			// An X source is always a handle, never a room.
			return platform === "x" ? name : "";
		})
		.filter(Boolean);
}

async function readSource({ source, keywords, now }) {
	const since = scanWindowStart({ lastScanAt: source.lastScanAt, now });

	if (source.platform === "reddit") {
		const { candidates, problems } = await searchReddit({ subreddits: [source.identifier], keywords, since });
		return { since, candidates, error: problems[0]?.error ?? null };
	}

	const { candidates, problems } = await searchHn({ keywords, since });
	// Hacker News is searched as a whole, so a problem there is the platform's, not this source's.
	return { since, candidates, error: problems[0]?.error ?? null };
}

async function scanProduct({ product, now }) {
	const keywords = product.keywords ?? [];
	const sources = await listScannableSources({ productId: product._id, platforms: readablePlatforms() });
	if (keywords.length === 0 || sources.length === 0) {
		return { productId: String(product._id), found: 0, kept: 0, created: 0, scored: 0, problems: [] };
	}

	const problems = [];
	const found = new Map();

	for (const source of sources) {
		const { candidates, error } = await readSource({ source, keywords, now });
		// A source that failed keeps its watermark, so the next scan covers the window this one missed.
		await markSourceScanned({ sourceId: source._id, at: now, error });
		if (error) {
			problems.push({ source: source.identifier, error });
			continue;
		}
		for (const candidate of candidates) found.set(candidate.externalId, candidate);
	}

	const candidates = [...found.values()];
	const known = await knownExternalIds({
		productId: product._id,
		externalIds: candidates.map(({ externalId }) => externalId),
	});
	const { kept, counts } = filterCandidates({ candidates, knownIds: known, ownAuthors: ownAuthors(sources) });

	// Stored before they are scored, so a scoring failure leaves posts in the queue unscored rather than
	// losing them until someone notices.
	const { created } = await saveCandidates({ workspaceId: product.workspaceId, productId: product._id, candidates: kept });

	let scored = 0;
	if (kept.length > 0 && isGtmAiConfigured()) {
		const result = await scoreCandidates({
			candidates: kept,
			profile: fromProductFields(product),
			askForJson,
			workspaceId: product.workspaceId,
			productId: product._id,
		});
		await saveScores({ productId: product._id, scores: result.scored });
		scored = result.scored.length;
		for (const problem of result.problems) problems.push({ source: "scoring", error: problem.error });
	}

	return { productId: String(product._id), found: candidates.length, kept: kept.length, created, scored, dropped: counts, problems };
}

export async function runRadarScan({ now = new Date() } = {}) {
	// A handled outcome, not a failure: the schedule can stay in place while the module is switched off,
	// and QStash must not retry it.
	if (!isGtmEnabled()) return { skipped: "the GTM agent is off" };

	await connectDb();
	const products = await GtmProduct.find({ onboardingStatus: "ready" }).lean();

	const results = [];
	for (const product of products) {
		// One founder's scan failing outright must not stop the others being scanned.
		try {
			results.push(await scanProduct({ product, now }));
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
