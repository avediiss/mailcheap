import "server-only";
import { connectDb } from "@/lib/db";
import { askForJson as askAi, createAiClient } from "@/lib/gtm/ai-core";
import GtmAiUsage from "@/models/gtm/AiUsage";

// The AI as the running app uses it: ai-core.js makes the call, this file records what it cost. Everything
// else in the module calls askForJson() and gets back either a validated object or a reason — no provider,
// no model name, no token accounting anywhere else, so swapping the provider later means rewriting
// ai-core.js and nothing above it.

let client;

function getClient() {
	client ??= createAiClient();
	return client;
}

async function logUsage({ workspaceId, productId, purpose, model, inputTokens, outputTokens, estimatedCostUsd, ok, error, durationMs }) {
	try {
		await connectDb();
		await GtmAiUsage.create({
			workspaceId,
			productId: productId ?? null,
			purpose,
			model,
			inputTokens,
			outputTokens,
			estimatedCostUsd,
			ok,
			error: error ? String(error).slice(0, 300) : undefined,
			durationMs,
		});
	} catch (loggingError) {
		// The cost model losing a row must not cost the founder their onboarding step.
		console.error(`[gtm ai] Could not log usage for ${purpose}:`, loggingError.message);
	}
}

// Asks for JSON, insists on the shape, and writes a gtm_ai_usage row for every call — the failed ones
// included, since they cost the same.
export async function askForJson({ workspaceId, productId, purpose, system, prompt, schema, read }) {
	return askAi({
		getClient,
		purpose,
		system,
		prompt,
		schema,
		read,
		onUsage: (usage) => logUsage({ workspaceId, productId, ...usage }),
	});
}
