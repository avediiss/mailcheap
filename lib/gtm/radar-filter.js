import { GTM_LIMITS } from "./config.js";

// The gate between searching and paying. Search is free and the queue is cheap; scoring is charged per
// post, so everything that can be rejected by a rule belongs here rather than in front of a model.
//
// What it deliberately does not do is judge whether a post is a real opportunity. That needs reading, and
// reading is the model's job: of eight posts a live scan returned, three were a résumé, a job ad and a
// launch announcement, all of which mention the keywords perfectly legitimately. No rule separates
// "mentions analytics" from "needs analytics". These rules only remove what is certainly not worth asking
// about.
//
// Relative imports and no "server-only": the Phase 6 command runs this under plain Node.

export const DROP_REASONS = {
	alreadySeen: "already in the queue",
	ownPost: "written by the founder",
	tooShort: "too short to reply to",
	tooOld: "older than the scan window",
	hiringThread: "a hiring thread, not a conversation",
	overCap: "over the cap for one scan",
};

// Hacker News runs the same handful of threads every month, each with hundreds of comments that mention
// tools by name: people listing their skills or their stack. Every one of them matches keywords and none
// of them is someone with a problem. Matching the thread title costs nothing; asking a model about each
// comment would cost for every single one.
// "What are you working on" is the same genre: a monthly thread of people describing their own projects,
// which mentions every tool there is and asks for nothing. Measured on a live scan, these threads were a
// third of everything the search returned.
const MEGATHREADS = [
	/who is hiring/i,
	/who wants to be hired/i,
	/seeking freelancer/i,
	/freelancer\?\s*seeking/i,
	/what are you working on/i,
];

export function isHiringThread(contextTitle) {
	return MEGATHREADS.some((pattern) => pattern.test(String(contextTitle ?? "")));
}

// Most keywords matched first, then newest. Only matters when there is more than a scan's worth: a post
// that several of the product's keywords found is the better bet, and among equals the fresher
// conversation is the one still worth joining.
function byPromise(a, b) {
	const keywords = (b.keywords?.length ?? 0) - (a.keywords?.length ?? 0);
	return keywords !== 0 ? keywords : new Date(b.postedAt) - new Date(a.postedAt);
}

// What a scan should pay to have read, and what it dropped on the way. Every drop carries its reason, so a
// founder asking "why am I seeing nothing" gets an answer rather than a shrug.
export function filterCandidates({
	candidates = [],
	knownIds = new Set(),
	ownAuthors = [],
	since = null,
	minLength = GTM_LIMITS.minCandidateLength,
	limit = GTM_LIMITS.maxScoredPerScan,
}) {
	const mine = new Set(
		ownAuthors
			.map((author) => String(author ?? "").trim().toLowerCase())
			.filter(Boolean)
	);
	const dropped = [];
	const passed = [];

	for (const candidate of candidates) {
		const reason = findReason(candidate, { knownIds, mine, since, minLength });
		if (reason) dropped.push({ externalId: candidate.externalId, reason });
		else passed.push(candidate);
	}

	const ranked = passed.sort(byPromise);
	const kept = ranked.slice(0, limit);
	for (const candidate of ranked.slice(limit)) {
		// Not rejected, just beyond what this scan will pay for. It stays unsaved, and the next scan finds
		// it again, because the watermark only moves over a window that was actually read.
		dropped.push({ externalId: candidate.externalId, reason: DROP_REASONS.overCap });
	}

	return { kept, dropped, counts: countReasons(dropped) };
}

function findReason(candidate, { knownIds, mine, since, minLength }) {
	if (knownIds.has(candidate.externalId)) return DROP_REASONS.alreadySeen;
	// Replying to yourself is the one false positive a founder would never forgive.
	if (mine.has(String(candidate.author ?? "").trim().toLowerCase())) return DROP_REASONS.ownPost;
	if (String(candidate.text ?? "").trim().length < minLength) return DROP_REASONS.tooShort;
	if (since && new Date(candidate.postedAt) < new Date(since)) return DROP_REASONS.tooOld;
	if (isHiringThread(candidate.contextTitle ?? candidate.storyTitle)) return DROP_REASONS.hiringThread;
	return null;
}

function countReasons(dropped) {
	const counts = {};
	for (const { reason } of dropped) counts[reason] = (counts[reason] ?? 0) + 1;
	return counts;
}
