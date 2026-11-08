import Anthropic from "@anthropic-ai/sdk";
import { GTM_LIMITS, estimateAiCost, getGtmAiModel, isGtmAiConfigured } from "./config.js";
import { parseJsonAnswer } from "./profile.js";

// How the GTM agent talks to an AI: build the request, read the answer, hold it to the shape asked for, and
// hand the caller what the call cost. What to do with that cost is the caller's business — lib/gtm/ai.js
// writes a gtm_ai_usage row, scripts/gtm-profiles.mjs prints it — and that is the only reason this is a
// file of its own. The provider lives here and nowhere else.
//
// Relative imports and no "server-only": scripts/gtm-profiles.mjs runs this under plain Node, where "@/"
// does not resolve and "server-only" throws. The same split as radar-jobs.js / radar-schedule.js.

export function createAiClient(env = process.env) {
	if (!isGtmAiConfigured(env)) throw new Error("The AI is not configured (ANTHROPIC_API_KEY)");
	// The SDK reads ANTHROPIC_API_KEY itself; passing it explicitly keeps the failure above honest.
	return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: GTM_LIMITS.aiTimeoutMs, maxRetries: 1 });
}

// Thinking is always on for this model family and its depth is set by effort, not a token budget. Output is
// a small JSON object, but thinking tokens come out of max_tokens too, so this is left roomy: a truncated
// answer would cost a whole second call to discover.
const MAX_OUTPUT_TOKENS = 16_000;

export function buildRequest({ system, prompt, schema, model = getGtmAiModel() }) {
	return {
		model,
		max_tokens: MAX_OUTPUT_TOKENS,
		system,
		messages: [{ role: "user", content: prompt }],
		output_config: {
			// medium is this model's own default; named here so changing it is a deliberate edit.
			effort: "medium",
			// The model is constrained to the shape rather than asked for it in prose.
			format: { type: "json_schema", schema },
		},
		// A safety decline would otherwise just stop. Reading a founder's marketing site should never
		// trip one, but a reply that silently didn't happen is the worse failure.
		betas: ["server-side-fallback-2026-07-01"],
		fallbacks: "default",
	};
}

function readTextBlocks(message) {
	return (message?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}

// A call that was refused at the door, said in words a founder can read. The SDK puts the whole JSON body
// in error.message, which is no use in a toast; the parsed body carries the sentence worth showing.
function describeApiError(error) {
	const status = error?.status;
	const detail = error?.error?.error?.message ?? error?.message ?? "the call failed";

	if (status === 401) return "the API key was rejected (401) — check ANTHROPIC_API_KEY";
	if (status === 403) return "that API key isn't allowed to make this call (403)";
	if (status === 404) return "the model was not found (404) — check GTM_AI_MODEL";
	if (status === 429) return "the API is rate-limiting us (429) — try again in a moment";
	if (status === 400) return `the request was rejected (400): ${detail}`;
	if (status >= 500) return `the API had a problem (${status}) — try again in a moment`;
	return detail;
}

// Why a response can't be used, or null. Checked before the content is read, because a refused or
// truncated message still has a content array — an empty or half-finished one.
export function getResponseProblem(message) {
	if (message?.stop_reason === "refusal") {
		const category = message.stop_details?.category ?? "unspecified";
		return `the model declined to answer (${category})`;
	}
	if (message?.stop_reason === "max_tokens") return "the answer was cut off before it finished";
	return null;
}

// What one call cost, in the shape both callers record it in. A model with no price in config.js gives a
// null cost rather than a zero: an unpriced call is an unknown, and the cost model should say so.
export function readUsage({ purpose, model, message, startedAt, ok, error }) {
	const inputTokens = message?.usage?.input_tokens ?? 0;
	const outputTokens = message?.usage?.output_tokens ?? 0;
	// The model that actually answered, which a fallback may have changed.
	const billedModel = message?.model ?? model;

	return {
		purpose,
		model: billedModel,
		inputTokens,
		outputTokens,
		estimatedCostUsd: estimateAiCost({ model: billedModel, inputTokens, outputTokens }),
		ok,
		error,
		durationMs: Date.now() - startedAt,
	};
}

// One call: ask, validate, and report what it cost. `read` is the validator for this purpose
// (lib/gtm/profile.js) and it decides whether an answer is usable. `getClient` is a function rather than a
// client so that a missing key fails inside the try, and so is reported like any other call failure.
async function askOnce({ getClient, purpose, system, prompt, schema, read, onUsage }) {
	// The model follows the purpose: cheap where the question is small, good where a person's name goes on
	// the answer.
	const model = getGtmAiModel(purpose);
	const startedAt = Date.now();
	let message;

	try {
		message = await getClient().beta.messages.create(buildRequest({ system, prompt, schema, model }));
	} catch (error) {
		// The call never produced an answer, so there is no answer to ask for again: a rejected key, a
		// malformed request or a missing model will fail the same way a second time, and the SDK already
		// retries the transient classes itself (maxRetries). Asking twice here only doubles the wait.
		const reason = describeApiError(error);
		await onUsage(readUsage({ purpose, model, startedAt, ok: false, error: reason }));
		return { error: reason, fatal: true };
	}

	const problem = getResponseProblem(message);
	if (problem) {
		await onUsage(readUsage({ purpose, model, message, startedAt, ok: false, error: problem }));
		return { error: problem };
	}

	const parsed = parseJsonAnswer(readTextBlocks(message));
	const result = parsed.error ? { error: parsed.error } : read(parsed.value);
	// A usable answer and an unusable one cost the same, so both are reported with their tokens.
	await onUsage(readUsage({ purpose, model, message, startedAt, ok: !result.error, error: result.error }));
	return result;
}

// Asks for JSON and insists on the shape, retrying once. Twice is the limit on purpose: a model that gets
// the shape wrong twice is being asked the wrong question, and a founder waiting on a page should be told
// so rather than kept waiting through a third call. The retry is for an answer that came back unusable —
// a call that never got an answer at all is reported as it is.
export async function askForJson({ getClient, purpose, system, prompt, schema, read, onUsage = () => {} }) {
	const first = await askOnce({ getClient, purpose, system, prompt, schema, read, onUsage });
	if (!first.error) return first;
	if (first.fatal) return { error: first.error };

	console.warn(`[gtm ai] ${purpose} gave an unusable answer, retrying once: ${first.error}`);
	const second = await askOnce({
		getClient,
		purpose,
		system,
		// The retry says what was wrong with the first answer, which is worth more than asking again blind.
		prompt: `${prompt}\n\n--- YOUR LAST ANSWER COULD NOT BE USED ---\nThe problem: ${first.error}\nReturn the whole profile again, in exactly the shape asked for above.`,
		schema,
		read,
		onUsage,
	});

	if (second.error) return { error: `the AI could not give a usable answer (${second.error})` };
	return second;
}
