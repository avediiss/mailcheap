// The GTM agent: finds posts worth replying to, drafts replies in the founder's voice, and tracks the
// signups that follow. It is a module of its own (lib/gtm, models/gtm, app/(app)/gtm) and every table it
// owns is named gtm_*, so it can be read, measured and removed without touching the newsletter product.

export const GTM_MODULE_NAME = "GTM agent";

// Off unless switched on, exactly like SENDING_ENABLED: an unset or misspelled value keeps it off. Nothing
// in the module runs without it — no pages, no server actions, no scheduled scan.
export function isGtmEnabled(env = process.env) {
	return env.GTM_ENABLED === "true";
}

// Every AI call goes through lib/gtm/ai.js, which needs this. Kept apart from isGtmEnabled so the UI can
// say "the module is on but the key is missing" instead of pretending the feature doesn't exist.
export function isGtmAiConfigured(env = process.env) {
	return Boolean(env.ANTHROPIC_API_KEY);
}

// Claude Opus 5.5. The model is read from the environment so it can be changed without a deploy, but the
// price table below has to know it: an unlisted model logs a null cost rather than a wrong one.
// Reddit needs an app of its own. Unauthenticated JSON was the obvious route and it is gone: every public
// endpoint answers 403 now, so the radar reads Reddit through OAuth or not at all. Without both values the
// module simply skips Reddit sources rather than failing a scan.
export function isGtmRedditConfigured(env = process.env) {
	return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);
}

export const DEFAULT_GTM_AI_MODEL = "claude-opus-5-5";

// Not every call deserves the same model. Scoring asks "is this person describing our problem", once per
// post, dozens of times a scan, about a short comment — a cheap model answers that as well as an expensive
// one, forty times cheaper. Drafting a reply that goes out under the founder's name does not get economised
// on. GTM_AI_MODEL still overrides everything, so one variable can pin the whole module to one model while
// testing.
export const GTM_AI_MODELS = {
	score_opportunity: "claude-haiku-5-5",
};

export function getGtmAiModel(purpose = "default", env = process.env) {
	return env.GTM_AI_MODEL?.trim() || GTM_AI_MODELS[purpose] || DEFAULT_GTM_AI_MODEL;
}

// US dollars per million tokens, as published for the first-party Anthropic API (checked 3 November 2026).
// Only the models this module would plausibly be pointed at: add a row before switching GTM_AI_MODEL to
// anything else, or the cost column in gtm_ai_usage goes empty.
export const AI_PRICES_PER_MILLION_TOKENS = {
	"claude-opus-5-5": { input: 4, output: 20 },
	"claude-opus-5": { input: 5, output: 25 },
	"claude-sonnet-5-5": { input: 2, output: 10 },
	"claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

// What one call cost, in dollars, or null for a model with no price on file. Rounded to six decimals:
// a single onboarding call is worth a fraction of a cent and the totals are summed over thousands of rows.
export function estimateAiCost({ model, inputTokens, outputTokens }) {
	const price = AI_PRICES_PER_MILLION_TOKENS[model];
	if (!price) return null;
	const dollars = ((inputTokens ?? 0) * price.input + (outputTokens ?? 0) * price.output) / 1_000_000;
	return Math.round(dollars * 1_000_000) / 1_000_000;
}

// Onboarding limits, shared by the schemas, the services and the forms so all three agree.
export const GTM_LIMITS = {
	// Under this much readable text the site is a JavaScript shell: the founder is asked to paste a
	// description instead of the reader guessing from a nav bar (lib/gtm/site-reader.js).
	minSiteTextLength: 300,
	maxSiteTextLength: 200_000,
	minVoiceSampleLength: 100,
	maxVoiceSampleLength: 5_000,
	minVoiceSamples: 3,
	maxVoiceSamples: 5,
	minInterviewQuestions: 3,
	maxInterviewQuestions: 4,
	maxPains: 3,
	minKeywords: 8,
	maxKeywords: 15,
	maxWatchedSources: 25,
	// Every outbound call is bounded: a founder's site that never answers must not hold a request open.
	siteFetchTimeoutMs: 10_000,
	searchTimeoutMs: 10_000,
	aiTimeoutMs: 60_000,
	// How often the radar scan runs.
	radarIntervalHours: 3,
	// How far back the very first scan of a source looks. Wider than the interval on purpose: a founder
	// who has just finished onboarding should find something in the queue rather than an empty page, and
	// on a quiet platform three hours of history is usually nothing at all.
	radarFirstRunHours: 168,
	// Posts read from one subreddit in one scan. Reddit's listings cap a page at 100, and a scan every
	// three hours is far ahead of any subreddit a founder would watch.
	maxRedditPostsPerSubreddit: 200,
	// How many posts one keyword may contribute to a scan. The radar searches newest first, so this is a
	// window on recent matches rather than a sample of the whole archive.
	maxCandidatesPerKeyword: 25,
	// Posts judged in one call. The product profile is sent once per batch rather than once per post, so
	// ten at a time costs a fraction of ten calls — but a batch large enough to crowd the instructions is
	// a batch the model starts rushing.
	scoreBatchSize: 10,
	// How much of a post the scorer reads. A comment long enough to need more than this has already said
	// what it wants in its first paragraph.
	maxScoreTextLength: 1_200,
	// Shorter than this and there is nothing to reply to: "+1", "same here", "thanks". Deliberately low,
	// because the best opportunities are often very short — "anyone know something simpler than GA4?" is
	// forty characters and is exactly the post a founder wants to find.
	minCandidateLength: 30,
	// The ceiling on how many posts one scan may put in front of the AI, whatever the keywords turn up.
	// Scoring is charged per post, so this is the line between a quiet bill and a surprising one: one badly
	// chosen keyword can match thousands of posts, and this stops that becoming thousands of calls while
	// nobody is watching.
	maxScoredPerScan: 50,
};
