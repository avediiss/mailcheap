import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AI_PRICES_PER_MILLION_TOKENS,
	DEFAULT_GTM_AI_MODEL,
	GTM_LIMITS,
	estimateAiCost,
	getGtmAiModel,
	isGtmAiConfigured,
	isGtmEnabled,
} from "../lib/gtm/config.js";

test("the module is off unless the flag is spelled exactly right", () => {
	assert.equal(isGtmEnabled({}), false, "unset");
	assert.equal(isGtmEnabled({ GTM_ENABLED: "true" }), true);
	// Anything else is off, rather than guessed at: a half-configured module must not start posting.
	assert.equal(isGtmEnabled({ GTM_ENABLED: "TRUE" }), false);
	assert.equal(isGtmEnabled({ GTM_ENABLED: "1" }), false);
	assert.equal(isGtmEnabled({ GTM_ENABLED: "yes" }), false);
	assert.equal(isGtmEnabled({ GTM_ENABLED: "false" }), false);
	assert.equal(isGtmEnabled({ GTM_ENABLED: " true" }), false);
});

test("the key is a separate question from the flag, so the UI can say which one is missing", () => {
	assert.equal(isGtmAiConfigured({}), false);
	assert.equal(isGtmAiConfigured({ ANTHROPIC_API_KEY: "sk-ant-test" }), true);
	assert.equal(isGtmEnabled({ ANTHROPIC_API_KEY: "sk-ant-test" }), false, "a key alone switches nothing on");
});

test("the model comes from the environment, with Claude Opus 5.5 as the default", () => {
	assert.equal(getGtmAiModel("default", {}), "claude-opus-5-5");
	assert.equal(DEFAULT_GTM_AI_MODEL, "claude-opus-5-5");
	assert.equal(getGtmAiModel("default", { GTM_AI_MODEL: "claude-haiku-5-5" }), "claude-haiku-5-5");
	assert.equal(getGtmAiModel("default", { GTM_AI_MODEL: "  claude-sonnet-5-5  " }), "claude-sonnet-5-5");
	assert.equal(getGtmAiModel("default", { GTM_AI_MODEL: "   " }), "claude-opus-5-5", "a blank setting falls back");
});

test("the default model has a price, or every cost logged would be null", () => {
	assert.ok(AI_PRICES_PER_MILLION_TOKENS[DEFAULT_GTM_AI_MODEL], "the default is on the price list");
});

test("the model follows the purpose, and one setting can still override every purpose", () => {
	// Scoring runs dozens of times a scan on short comments; drafting goes out under the founder's name.
	const scoring = getGtmAiModel("score_opportunity", {});
	assert.equal(scoring, "claude-haiku-5-5");
	assert.notEqual(scoring, getGtmAiModel("draft_reply", {}));
	assert.equal(getGtmAiModel("draft_reply", {}), DEFAULT_GTM_AI_MODEL);
	// A purpose nobody has priced differently falls back rather than failing.
	assert.equal(getGtmAiModel("something_new", {}), DEFAULT_GTM_AI_MODEL);
	// One variable pins the whole module to one model while testing.
	assert.equal(getGtmAiModel("score_opportunity", { GTM_AI_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");

	const cheap = AI_PRICES_PER_MILLION_TOKENS[scoring];
	const standard = AI_PRICES_PER_MILLION_TOKENS[DEFAULT_GTM_AI_MODEL];
	assert.ok(cheap, "the scoring model is on the price list");
	// The whole point of the split: if this stops being true, the split is costing complexity for nothing.
	assert.ok(cheap.input < standard.input && cheap.output < standard.output);
});

test("a call's cost is worked out from the tokens actually billed", () => {
	// 12,000 input at $4/M is $0.048; 800 output at $20/M is $0.016.
	assert.equal(estimateAiCost({ model: "claude-opus-5-5", inputTokens: 12_000, outputTokens: 800 }), 0.064);
	assert.equal(estimateAiCost({ model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 1_000 }), 0.0015);
	assert.equal(estimateAiCost({ model: "claude-opus-5-5", inputTokens: 0, outputTokens: 0 }), 0);
});

test("a model with no price on file costs null, not nothing", () => {
	// Summing a guess into the cost model would be worse than leaving a gap in it.
	assert.equal(estimateAiCost({ model: "some-other-model", inputTokens: 10_000, outputTokens: 500 }), null);
	assert.equal(estimateAiCost({ model: undefined, inputTokens: 10_000, outputTokens: 500 }), null);
});

test("missing token counts are treated as none, so a partial response still logs", () => {
	assert.equal(estimateAiCost({ model: "claude-opus-5-5", outputTokens: 1_000 }), 0.02);
	assert.equal(estimateAiCost({ model: "claude-opus-5-5", inputTokens: 1_000 }), 0.004);
});

test("the limits the services and the forms both read", () => {
	assert.equal(GTM_LIMITS.minSiteTextLength, 300, "under this, the site is a JavaScript shell");
	assert.equal(GTM_LIMITS.minVoiceSampleLength, 100);
	assert.ok(GTM_LIMITS.minVoiceSamples <= GTM_LIMITS.maxVoiceSamples);
	assert.ok(GTM_LIMITS.minKeywords < GTM_LIMITS.maxKeywords);
	assert.ok(GTM_LIMITS.minInterviewQuestions <= GTM_LIMITS.maxInterviewQuestions);
	// Every outbound call is bounded.
	assert.ok(GTM_LIMITS.siteFetchTimeoutMs > 0 && GTM_LIMITS.aiTimeoutMs > 0);
});
