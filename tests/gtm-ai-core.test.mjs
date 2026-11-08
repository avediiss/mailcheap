import assert from "node:assert/strict";
import { test } from "node:test";
import { askForJson, buildRequest, getResponseProblem, readUsage } from "../lib/gtm/ai-core.js";
import { AI_PRICES_PER_MILLION_TOKENS, DEFAULT_GTM_AI_MODEL } from "../lib/gtm/config.js";

// lib/gtm/ai-core.js is the module's only route to a provider, and until Phase 5 it could not be tested
// here: it was part of a "server-only" file. These tests hold the request shape, the unusable-answer cases
// and the retry to what the module promises, with a fake client in place of the SDK.

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } } };

// A validator of the same shape as readProfile(): an answer is usable, or it says why not.
function readOk(value) {
	return value?.ok === true ? { value } : { error: "ok was not true" };
}

function message({ json, model = DEFAULT_GTM_AI_MODEL, inputTokens = 1_000, outputTokens = 500, ...rest } = {}) {
	return {
		model,
		stop_reason: "end_turn",
		usage: { input_tokens: inputTokens, output_tokens: outputTokens },
		// A thinking block comes first on this model family; reading the text has to ignore it.
		content: [
			{ type: "thinking", thinking: "weighing it up" },
			{ type: "text", text: JSON.stringify(json ?? { ok: true }) },
		],
		...rest,
	};
}

// What the SDK throws: the status, and the parsed body whose message is the sentence worth showing. Its
// own .message is the whole JSON blob, which is what we must not put in front of a founder.
function apiError({ throws, status, type = "invalid_request_error" }) {
	const error = new Error(status ? `${status} {"type":"error","error":{"type":"${type}","message":"${throws}"}}` : throws);
	if (status) {
		error.status = status;
		error.error = { type: "error", error: { type, message: throws } };
	}
	return error;
}

// Answers the queue in order, and keeps the requests it was given.
function fakeClient(answers) {
	const requests = [];
	const client = {
		beta: {
			messages: {
				create: async (request) => {
					requests.push(request);
					const answer = answers.shift();
					if (!answer) throw new Error("the fake client was asked one time too many");
					if (answer.throws) throw apiError(answer);
					return answer;
				},
			},
		},
	};
	return { client, requests };
}

test("the request constrains the model to the schema rather than asking for it", () => {
	const request = buildRequest({ system: "be brief", prompt: "the site says", schema: SCHEMA });

	assert.equal(request.model, DEFAULT_GTM_AI_MODEL);
	assert.equal(request.system, "be brief");
	assert.deepEqual(request.messages, [{ role: "user", content: "the site says" }]);
	assert.deepEqual(request.output_config.format, { type: "json_schema", schema: SCHEMA });
	assert.equal(request.output_config.effort, "medium");
	// Thinking tokens come out of max_tokens too, so there is room for more than the JSON object.
	assert.ok(request.max_tokens >= 8_000);
	// A safety decline is retried on another model inside the same call instead of simply stopping.
	assert.deepEqual(request.betas, ["server-side-fallback-2026-07-01"]);
	assert.equal(request.fallbacks, "default");
});

test("the request uses the model it is given", () => {
	assert.equal(buildRequest({ system: "s", prompt: "p", schema: SCHEMA, model: "claude-haiku-5-5" }).model, "claude-haiku-5-5");
});

test("a refusal and a truncation are reported in words, not parsed", () => {
	assert.match(
		getResponseProblem({ stop_reason: "refusal", stop_details: { category: "harmful_content" } }),
		/declined to answer \(harmful_content\)/
	);
	// A refusal with no category still has to read as a refusal.
	assert.match(getResponseProblem({ stop_reason: "refusal" }), /declined to answer \(unspecified\)/);
	assert.equal(getResponseProblem({ stop_reason: "max_tokens" }), "the answer was cut off before it finished");
	assert.equal(getResponseProblem(message()), null);
	assert.equal(getResponseProblem(undefined), null);
});

test("usage is counted against the model that answered, not the one asked for", () => {
	const usage = readUsage({
		purpose: "profile_extract",
		model: "claude-opus-5-5",
		// A server-side fallback answered on a cheaper model, and that is what was billed.
		message: message({ model: "claude-haiku-5-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
		startedAt: Date.now(),
		ok: true,
	});

	assert.equal(usage.model, "claude-haiku-5-5");
	const price = AI_PRICES_PER_MILLION_TOKENS["claude-haiku-5-5"];
	assert.equal(usage.estimatedCostUsd, price.input + price.output);
	assert.equal(usage.purpose, "profile_extract");
	assert.equal(usage.ok, true);
	assert.ok(usage.durationMs >= 0);
});

test("a failed call still reports its purpose, with no tokens", () => {
	const usage = readUsage({
		purpose: "interview_questions",
		model: "claude-opus-5-5",
		startedAt: Date.now(),
		ok: false,
		error: "timed out",
	});

	assert.equal(usage.inputTokens, 0);
	assert.equal(usage.outputTokens, 0);
	assert.equal(usage.estimatedCostUsd, 0);
	assert.equal(usage.ok, false);
	assert.equal(usage.error, "timed out");
});

test("a model with no price gives an unknown cost, not a free one", () => {
	const usage = readUsage({
		purpose: "draft_reply",
		model: "some-model-we-have-not-priced",
		message: message({ model: "some-model-we-have-not-priced" }),
		startedAt: Date.now(),
		ok: true,
	});

	assert.equal(usage.estimatedCostUsd, null);
});

test("a usable answer is returned and reported once", async () => {
	const { client, requests } = fakeClient([message({ json: { ok: true } })]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.deepEqual(result, { value: { ok: true } });
	assert.equal(requests.length, 1);
	assert.equal(usage.length, 1);
	assert.equal(usage[0].ok, true);
	assert.equal(usage[0].inputTokens, 1_000);
});

test("an unusable answer is retried once, and the retry is told what was wrong", async () => {
	const { client, requests } = fakeClient([message({ json: { ok: false } }), message({ json: { ok: true } })]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "the first prompt",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.deepEqual(result, { value: { ok: true } });
	assert.equal(requests.length, 2);
	// The retry carries the original prompt plus the reason, which is worth more than asking again blind.
	assert.match(requests[1].messages[0].content, /^the first prompt/);
	assert.match(requests[1].messages[0].content, /ok was not true/);
	// Both attempts cost money, so both are reported.
	assert.equal(usage.length, 2);
	assert.equal(usage[0].ok, false);
	assert.equal(usage[1].ok, true);
});

test("two unusable answers give up with the reason, and never ask a third time", async () => {
	const { client, requests } = fakeClient([message({ json: { ok: false } }), message({ json: { ok: false } })]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.match(result.error, /could not give a usable answer/);
	assert.match(result.error, /ok was not true/);
	assert.equal(result.value, undefined);
	assert.equal(requests.length, 2);
	assert.equal(usage.length, 2);
});

test("a call that throws is reported rather than raised, and asked only once", async () => {
	const { client, requests } = fakeClient([{ throws: "connection closed" }, { throws: "connection closed" }]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.match(result.error, /connection closed/);
	// No answer came back, so there is no answer to ask for again.
	assert.equal(requests.length, 1);
	assert.equal(usage.length, 1);
	assert.equal(usage[0].ok, false);
	assert.equal(usage[0].inputTokens, 0);
});

test("a rejected key is said in words, and the call is not repeated", async () => {
	const { client, requests } = fakeClient([
		{ throws: "Invalid bearer token", status: 401, type: "authentication_error" },
		{ throws: "Invalid bearer token", status: 401, type: "authentication_error" },
	]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.match(result.error, /API key was rejected \(401\)/);
	assert.match(result.error, /ANTHROPIC_API_KEY/);
	// Not the JSON body the SDK puts in error.message.
	assert.doesNotMatch(result.error, /\{"type"/);
	assert.equal(requests.length, 1);
	assert.equal(usage.length, 1);
});

test("a malformed request keeps the API's own sentence", async () => {
	// The live failure this pair of fixes came from.
	const schemaComplaint = "output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported";
	const { client, requests } = fakeClient([{ throws: schemaComplaint, status: 400 }]);

	const result = await askForJson({
		getClient: () => client,
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
	});

	assert.match(result.error, /the request was rejected \(400\)/);
	assert.match(result.error, /minItems/);
	assert.equal(requests.length, 1);
});

test("a missing key is reported like any other failure, not thrown at the caller", async () => {
	const usage = [];

	const result = await askForJson({
		getClient: () => {
			throw new Error("The AI is not configured (ANTHROPIC_API_KEY)");
		},
		purpose: "profile_extract",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.match(result.error, /ANTHROPIC_API_KEY/);
	assert.equal(usage.length, 1);
});

test("a refused answer is not read as content", async () => {
	const refusal = { ...message(), stop_reason: "refusal", stop_details: { category: "harmful_content" }, content: [] };
	const { client } = fakeClient([refusal, { ...refusal }]);
	const usage = [];

	const result = await askForJson({
		getClient: () => client,
		purpose: "draft_reply",
		system: "s",
		prompt: "p",
		schema: SCHEMA,
		read: readOk,
		onUsage: (row) => usage.push(row),
	});

	assert.match(result.error, /declined to answer/);
	// The tokens of a refused call were still spent.
	assert.equal(usage[0].inputTokens, 1_000);
});
