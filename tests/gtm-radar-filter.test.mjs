import assert from "node:assert/strict";
import { test } from "node:test";
import { GTM_LIMITS } from "../lib/gtm/config.js";
import { DROP_REASONS, filterCandidates, isHiringThread } from "../lib/gtm/radar-filter.js";

// Everything this gate drops is a post nobody pays to have read. Everything it keeps costs money, so the
// rules have to be ones a person would agree with on sight — and they must not quietly drop the short,
// blunt questions that are the best opportunities a radar can find.

function candidate(overrides = {}) {
	return {
		externalId: "1",
		author: "someone",
		text: "GA4 is confusing and I cannot find basic traffic numbers without building a report.",
		postedAt: new Date("2026-11-07T12:00:00.000Z"),
		keywords: ["ga4"],
		contextTitle: "Ask HN: what analytics do you use?",
		...overrides,
	};
}

function reasons(dropped) {
	return dropped.map((drop) => drop.reason);
}

test("a post worth replying to passes", () => {
	const { kept, dropped } = filterCandidates({ candidates: [candidate()] });

	assert.equal(kept.length, 1);
	assert.deepEqual(dropped, []);
});

test("a short blunt question is kept, because it is the best kind of opportunity", () => {
	// Thirty-nine characters, no detail, and exactly the post a founder wants to find. A higher minimum
	// would quietly throw these away and the queue would fill with essays instead.
	const { kept } = filterCandidates({ candidates: [candidate({ text: "anyone know something simpler than GA4?" })] });

	assert.equal(kept.length, 1);
});

test("an acknowledgement is not a conversation", () => {
	const { kept, dropped } = filterCandidates({
		candidates: [candidate({ text: "+1" }), candidate({ externalId: "2", text: "same here, thanks" })],
	});

	assert.equal(kept.length, 0);
	assert.deepEqual(reasons(dropped), [DROP_REASONS.tooShort, DROP_REASONS.tooShort]);
});

test("a post already in the queue is not offered twice", () => {
	const { kept, dropped } = filterCandidates({
		candidates: [candidate({ externalId: "seen" })],
		knownIds: new Set(["seen"]),
	});

	assert.equal(kept.length, 0);
	assert.equal(dropped[0].reason, DROP_REASONS.alreadySeen);
});

test("the founder is never shown their own post", () => {
	const { kept, dropped } = filterCandidates({
		candidates: [candidate({ author: "AbakelianAvedis" })],
		// Case and spacing are the platform's business, not the founder's.
		ownAuthors: ["  abakelianavedis "],
	});

	assert.equal(kept.length, 0);
	assert.equal(dropped[0].reason, DROP_REASONS.ownPost);
});

test("a post older than the window is dropped even if the search returned it", () => {
	const since = new Date("2026-11-07T00:00:00.000Z");
	const { kept, dropped } = filterCandidates({
		candidates: [candidate({ postedAt: new Date("2026-11-06T23:59:00.000Z") }), candidate({ externalId: "2" })],
		since,
	});

	assert.equal(kept.length, 1);
	assert.equal(kept[0].externalId, "2");
	assert.equal(dropped[0].reason, DROP_REASONS.tooOld);
});

test("hiring threads are recognised, whatever month they are", () => {
	assert.ok(isHiringThread("Ask HN: Who is hiring? (November 2026)"));
	assert.ok(isHiringThread("Ask HN: Who wants to be hired? (November 2026)"));
	assert.ok(isHiringThread("Ask HN: Freelancer? Seeking freelancer? (November 2026)"));
	// The measured false positive: a résumé listing tools, matching keywords perfectly legitimately.
	assert.ok(isHiringThread("ask hn: who wants to be hired?"));
	// Same genre: people describing their own projects, mentioning every tool, asking for nothing.
	assert.ok(isHiringThread("Ask HN: What are you working on? (November 2026)"));
	assert.equal(isHiringThread("Ask HN: what analytics do you use?"), false);
	assert.equal(isHiringThread(""), false);
	assert.equal(isHiringThread(null), false);
});

test("a comment in a hiring thread is dropped before anyone pays to read it", () => {
	const { kept, dropped } = filterCandidates({
		candidates: [candidate({ contextTitle: "Ask HN: Who wants to be hired? (November 2026)" })],
	});

	assert.equal(kept.length, 0);
	assert.equal(dropped[0].reason, DROP_REASONS.hiringThread);
});

test("the platform's own field name still works", () => {
	// hn.js calls it storyTitle; the store renames it. The filter runs on either side of that.
	const { dropped } = filterCandidates({
		candidates: [candidate({ contextTitle: undefined, storyTitle: "Ask HN: Who is hiring? (November 2026)" })],
	});

	assert.equal(dropped[0].reason, DROP_REASONS.hiringThread);
});

test("the cap is a hard ceiling, and the most promising posts are the ones kept", () => {
	const candidates = [
		candidate({ externalId: "one-keyword-old", keywords: ["a"], postedAt: new Date("2026-11-01T00:00:00.000Z") }),
		candidate({ externalId: "three-keywords", keywords: ["a", "b", "c"], postedAt: new Date("2026-11-02T00:00:00.000Z") }),
		candidate({ externalId: "one-keyword-new", keywords: ["a"], postedAt: new Date("2026-11-07T00:00:00.000Z") }),
	];

	const { kept, dropped, counts } = filterCandidates({ candidates, limit: 2 });

	// Most keywords first, then newest among equals.
	assert.deepEqual(
		kept.map((entry) => entry.externalId),
		["three-keywords", "one-keyword-new"]
	);
	assert.equal(dropped[0].externalId, "one-keyword-old");
	assert.equal(counts[DROP_REASONS.overCap], 1);
});

test("the cap defaults to the configured ceiling, not to everything found", () => {
	const candidates = Array.from({ length: GTM_LIMITS.maxScoredPerScan + 10 }, (_, index) => candidate({ externalId: String(index) }));

	const { kept, counts } = filterCandidates({ candidates });

	assert.equal(kept.length, GTM_LIMITS.maxScoredPerScan);
	assert.equal(counts[DROP_REASONS.overCap], 10);
});

test("every drop is counted by reason, so an empty queue can be explained", () => {
	const { kept, counts } = filterCandidates({
		candidates: [
			candidate({ externalId: "a", text: "+1" }),
			candidate({ externalId: "b", text: "me too" }),
			candidate({ externalId: "c", author: "founder" }),
			candidate({ externalId: "d", contextTitle: "Ask HN: Who is hiring? (November 2026)" }),
			candidate({ externalId: "e" }),
		],
		ownAuthors: ["founder"],
	});

	assert.equal(kept.length, 1);
	assert.deepEqual(counts, {
		[DROP_REASONS.tooShort]: 2,
		[DROP_REASONS.ownPost]: 1,
		[DROP_REASONS.hiringThread]: 1,
	});
});

test("nothing found is not an error", () => {
	assert.deepEqual(filterCandidates({ candidates: [] }), { kept: [], dropped: [], counts: {} });
	assert.deepEqual(filterCandidates({}), { kept: [], dropped: [], counts: {} });
});
