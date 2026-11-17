import assert from "node:assert/strict";
import { test } from "node:test";
import { GTM_LIMITS } from "../lib/gtm/config.js";
import { SCORE_SYSTEM, buildScorePrompt } from "../lib/gtm/prompts/score.js";
import { SCORE_JSON_SCHEMA, batch, readScores, scoreCandidates } from "../lib/gtm/radar-score.js";

// The one judgement in the radar, and the only part charged per post. Two things have to hold: a score can
// only ever land on a post that was actually asked about, and one bad batch costs the scan that batch
// rather than the whole run.

const profile = {
	one_line_pitch: "Privacy-friendly website analytics without a cookie banner.",
	target_customer: "Site owners who find Google Analytics overkill.",
	pains: ["GA4 is confusing.", "Cookie banners annoy visitors.", "The script slows the site down."],
	differentiators: "One page of numbers, no cookies, no consent banner.",
};

function candidate(externalId, overrides = {}) {
	return {
		externalId,
		author: "someone",
		text: "I gave up on GA4 last week, what is everyone using instead?",
		keywords: ["ga4"],
		contextTitle: "Ask HN: what analytics do you use?",
		...overrides,
	};
}

// Answers each batch from a queue, and records what it was asked.
function fakeAsk(answers) {
	const calls = [];
	const askForJson = async (options) => {
		calls.push(options);
		const answer = answers.shift() ?? { error: "the fake was asked one time too many" };
		if (answer.error) return { error: answer.error };
		// The real askForJson runs the validator; the fake must too, or these tests prove nothing.
		return options.read(answer.value);
	};
	return { askForJson, calls };
}

test("the schema asks for an id, a number and a reason, and nothing else", () => {
	const entry = SCORE_JSON_SCHEMA.properties.scores.items;

	assert.deepEqual(entry.required.sort(), ["external_id", "reason", "score"]);
	assert.equal(entry.additionalProperties, false);
	assert.equal(entry.properties.score.type, "integer");
	// No minItems or maxItems anywhere: the API rejects a structured-output schema that sets minItems
	// above 1, which cost a live call to discover in Week 1.
	assert.equal(SCORE_JSON_SCHEMA.properties.scores.minItems, undefined);
	assert.equal(SCORE_JSON_SCHEMA.properties.scores.maxItems, undefined);
});

test("the prompt tells the model about the product and every post, with its context", () => {
	const prompt = buildScorePrompt({
		profile,
		candidates: [candidate("a"), candidate("b", { contextTitle: "Show HN: my thing" })],
	});

	assert.match(prompt, /Privacy-friendly website analytics/);
	assert.match(prompt, /GA4 is confusing\./);
	assert.match(prompt, /id: a/);
	assert.match(prompt, /id: b/);
	// What a post is a reply to is often the whole explanation of why it is irrelevant.
	assert.match(prompt, /posted under: Show HN: my thing/);
	assert.match(prompt, /found by: ga4/);
});

test("a long post is cut, so one essay cannot cost what ten posts should", () => {
	const prompt = buildScorePrompt({ profile, candidates: [candidate("a", { text: "x".repeat(5_000) })], maxTextLength: 100 });

	assert.match(prompt, /x{100}(?!x)/);
	assert.ok(prompt.length < 3_000);
});

test("the system prompt expects to say no, and says so", () => {
	// Of eight posts that reached scoring on a live scan, the right answer for all eight was no. A prompt
	// reading "find the good ones" produces a model that finds good ones whether or not they exist.
	assert.match(SCORE_SYSTEM, /Most posts are not/);
	assert.match(SCORE_SYSTEM, /correct answer, not a failure/);
});

test("posts are judged in batches, not one call each", () => {
	assert.equal(batch([1, 2, 3, 4, 5], 2).length, 3);
	assert.deepEqual(batch([1, 2, 3], 10), [[1, 2, 3]]);
	assert.deepEqual(batch([], 10), []);
	assert.ok(GTM_LIMITS.scoreBatchSize > 1);
});

test("a good answer is read into scores", () => {
	const { value } = readScores(
		{ scores: [{ external_id: "a", score: 85, reason: "Asking what to use after leaving GA4." }] },
		{ expected: ["a"] }
	);

	assert.deepEqual(value, [{ externalId: "a", score: 85, reason: "Asking what to use after leaving GA4." }]);
});

test("a score for a post nobody asked about is dropped, not stored", () => {
	// Otherwise a model inventing an id would put a score on a post that was never in the batch.
	const result = readScores({ scores: [{ external_id: "never-sent", score: 90, reason: "invented" }] }, { expected: ["a"] });

	assert.match(result.error, /no usable scores/);
});

test("entries missing a number or a reason are dropped, and the rest still count", () => {
	const { value } = readScores(
		{
			scores: [
				{ external_id: "a", score: "high", reason: "no number" },
				{ external_id: "b", score: 40, reason: "   " },
				{ external_id: "c", score: 70, reason: "Complaining about GA4's reports." },
			],
		},
		{ expected: ["a", "b", "c"] }
	);

	assert.deepEqual(
		value.map((entry) => entry.externalId),
		["c"]
	);
});

test("a score outside the range is pulled back into it rather than refused", () => {
	const { value } = readScores(
		{
			scores: [
				{ external_id: "a", score: 120, reason: "very keen" },
				{ external_id: "b", score: -5, reason: "not at all" },
				{ external_id: "c", score: 72.6, reason: "fractional" },
			],
		},
		{ expected: ["a", "b", "c"] }
	);

	assert.deepEqual(
		value.map((entry) => entry.score),
		[100, 0, 73]
	);
});

test("the same post scored twice in one answer is counted once", () => {
	const { value } = readScores(
		{
			scores: [
				{ external_id: "a", score: 90, reason: "first" },
				{ external_id: "a", score: 10, reason: "second" },
			],
		},
		{ expected: ["a"] }
	);

	assert.equal(value.length, 1);
	assert.equal(value[0].reason, "first");
});

test("an answer of the wrong shape is an error, so the call is retried", () => {
	assert.match(readScores(null, { expected: ["a"] }).error, /not an object/);
	assert.match(readScores({ scores: "none" }, { expected: ["a"] }).error, /not a list/);
	assert.match(readScores({ scores: [] }, { expected: ["a"] }).error, /no usable scores/);
});

test("every post kept is scored, in as few calls as the batch size allows", async () => {
	const candidates = [candidate("a"), candidate("b"), candidate("c")];
	const { askForJson, calls } = fakeAsk([
		{
			value: {
				scores: [
					{ external_id: "a", score: 90, reason: "Asking for a recommendation." },
					{ external_id: "b", score: 10, reason: "Arguing about GDPR." },
				],
			},
		},
		{ value: { scores: [{ external_id: "c", score: 55, reason: "Mentions it in passing." }] } },
	]);

	const { scored, unscored, problems } = await scoreCandidates({ candidates, profile, askForJson, batchSize: 2 });

	assert.equal(calls.length, 2);
	assert.equal(scored.length, 3);
	assert.deepEqual(unscored, []);
	assert.deepEqual(problems, []);
	// The purpose is what picks the cheap model, so it has to be the one the config knows.
	assert.equal(calls[0].purpose, "score_opportunity");
});

test("a batch that failed costs that batch, not the scan", async () => {
	const candidates = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
	const { askForJson } = fakeAsk([
		{ error: "the AI could not give a usable answer" },
		{ value: { scores: [{ external_id: "c", score: 30, reason: "Adjacent." }] } },
	]);

	const { scored, unscored, problems } = await scoreCandidates({ candidates, profile, askForJson, batchSize: 2 });

	assert.deepEqual(
		scored.map((entry) => entry.externalId),
		["c"]
	);
	// Unscored, not lost: the posts are saved without a score and the next scan can try again.
	assert.deepEqual(unscored.sort(), ["a", "b", "d"]);
	assert.equal(problems.length, 1);
	assert.deepEqual(problems[0].externalIds, ["a", "b"]);
});

test("nothing kept costs nothing", async () => {
	const { askForJson, calls } = fakeAsk([]);
	const result = await scoreCandidates({ candidates: [], profile, askForJson });

	assert.deepEqual(result, { scored: [], unscored: [], problems: [] });
	assert.equal(calls.length, 0);
});
