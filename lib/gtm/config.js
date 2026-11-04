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
export const DEFAULT_GTM_AI_MODEL = "claude-opus-5-5";

export function getGtmAiModel(env = process.env) {
	return env.GTM_AI_MODEL?.trim() || DEFAULT_GTM_AI_MODEL;
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
	aiTimeoutMs: 60_000,
	// How often the radar scan runs, once Phase 2 schedules it.
	radarIntervalHours: 3,
};
