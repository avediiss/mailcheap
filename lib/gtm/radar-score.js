import { GTM_LIMITS } from "./config.js";
import { SCORE_SYSTEM, buildScorePrompt } from "./prompts/score.js";

// Reading the posts a scan found and deciding which deserve a founder's reply. The only part of the radar
// that costs money per post, and the only part that can tell "mentions analytics" from "needs analytics".
//
// askForJson is injected rather than imported: the app passes the one from lib/gtm/ai.js, which logs every
// call to gtm_ai_usage, and a script passes ai-core's directly. This file never knows which.
//
// Relative imports and no "server-only": the Phase 6 command runs this under plain Node.

// Posts are scored in batches: one call about ten posts costs far less than ten calls about one, because
// the product profile is sent once instead of ten times.
export const SCORE_JSON_SCHEMA = {
	type: "object",
	properties: {
		scores: {
			type: "array",
			items: {
				type: "object",
				properties: {
					external_id: { type: "string" },
					score: { type: "integer" },
					reason: { type: "string" },
				},
				required: ["external_id", "score", "reason"],
				additionalProperties: false,
			},
		},
	},
	required: ["scores"],
	additionalProperties: false,
};

export function batch(items, size = GTM_LIMITS.scoreBatchSize) {
	const batches = [];
	for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
	return batches;
}

// Reads one batch's answer. An entry for a post that was not in the batch is dropped rather than trusted:
// a model inventing an id would otherwise score a post nobody asked about. A batch that comes back with
// nothing usable is an error, which askForJson retries once; a batch missing one or two entries is not,
// because asking about ten posts again to recover one costs more than leaving it for the next scan.
export function readScores(value, { expected = [] } = {}) {
	if (!value || typeof value !== "object") return { error: "the answer was not an object" };
	if (!Array.isArray(value.scores)) return { error: "scores is not a list" };

	const wanted = new Set(expected);
	const seen = new Set();
	const scores = [];

	for (const entry of value.scores) {
		const externalId = String(entry?.external_id ?? "").trim();
		if (!externalId || !wanted.has(externalId) || seen.has(externalId)) continue;

		const score = Number(entry?.score);
		if (!Number.isFinite(score)) continue;

		const reason = String(entry?.reason ?? "").trim();
		if (!reason) continue;

		seen.add(externalId);
		scores.push({
			externalId,
			// The prompt asks for 0 to 100; a model answering 120 meant "very high", not an error.
			score: Math.min(Math.max(Math.round(score), 0), 100),
			reason: reason.slice(0, 300),
		});
	}

	if (scores.length === 0) return { error: "no usable scores came back" };
	return { value: scores };
}

// Scores everything a scan kept. Returns what each post was given, what came back unscored, and the
// problems met on the way: one batch failing is not the scan failing, and the posts in it simply stay
// unscored until the next one.
export async function scoreCandidates({
	candidates = [],
	profile,
	askForJson,
	workspaceId,
	productId,
	batchSize = GTM_LIMITS.scoreBatchSize,
	maxTextLength = GTM_LIMITS.maxScoreTextLength,
}) {
	if (candidates.length === 0) return { scored: [], unscored: [], problems: [] };

	const scored = [];
	const problems = [];
	const done = new Set();

	for (const group of batch(candidates, batchSize)) {
		const expected = group.map((candidate) => candidate.externalId);
		const result = await askForJson({
			workspaceId,
			productId,
			purpose: "score_opportunity",
			system: SCORE_SYSTEM,
			prompt: buildScorePrompt({ profile, candidates: group, maxTextLength }),
			schema: SCORE_JSON_SCHEMA,
			read: (value) => readScores(value, { expected }),
		});

		if (result.error) {
			problems.push({ externalIds: expected, error: result.error });
			continue;
		}

		for (const entry of result.value) {
			done.add(entry.externalId);
			scored.push(entry);
		}
	}

	const unscored = candidates.map((candidate) => candidate.externalId).filter((externalId) => !done.has(externalId));
	return { scored, unscored, problems };
}
