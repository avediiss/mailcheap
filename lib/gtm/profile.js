import { GTM_LIMITS } from "./config.js";

// The profile the AI must return, and the checks it has to pass. Both the schema sent to the model and the
// validation done on the answer live here: the model is asked for this shape and then held to it, because a
// structured-output guarantee is still a promise about a response that has to survive the trip.
//
// Relative imports and no "server-only": scripts/gtm-profiles.mjs (Phase 5) runs this under plain Node.

// Sent as output_config.format, so the model is constrained rather than merely asked.
//
// No minItems or maxItems on the arrays, however much the counts matter: the API rejects the whole request
// with a 400 when a structured-output schema sets minItems above 1 ("values other than 0 or 1 are not
// supported"). How many of each we want is said in the prompt and enforced by readProfile() below, which
// was always the thing holding an answer to its counts — the schema only ever fixed its shape.
export const PROFILE_JSON_SCHEMA = {
	type: "object",
	properties: {
		one_line_pitch: { type: "string" },
		target_customer: { type: "string" },
		pains: { type: "array", items: { type: "string" } },
		differentiators: { type: "string" },
		keywords: { type: "array", items: { type: "string" } },
		suggested_communities: { type: "array", items: { type: "string" } },
	},
	required: ["one_line_pitch", "target_customer", "pains", "differentiators", "keywords", "suggested_communities"],
	additionalProperties: false,
};

// Bounded in readInterviewQuestions() and in the prompt, not here, for the same reason as above.
export const INTERVIEW_JSON_SCHEMA = {
	type: "object",
	properties: {
		questions: { type: "array", items: { type: "string" } },
	},
	required: ["questions"],
	additionalProperties: false,
};

const MAX_PITCH_LENGTH = 300;

// Models sometimes wrap JSON in a ```json fence even when told not to. Unwrapping it is cheaper than
// spending a retry on something this mechanical.
export function parseJsonAnswer(text) {
	const trimmed = String(text ?? "").trim();
	if (!trimmed) return { error: "the model returned nothing" };

	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
	try {
		return { value: JSON.parse(fenced ? fenced[1] : trimmed) };
	} catch {
		return { error: "the model's answer was not valid JSON" };
	}
}

function readStrings(value, { min, max, maxLength }) {
	if (!Array.isArray(value)) return { error: "is not a list" };
	const cleaned = value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
	if (cleaned.length < min) return { error: `has ${cleaned.length}, needs at least ${min}` };
	if (cleaned.some((entry) => entry.length > maxLength)) return { error: `has an entry over ${maxLength} characters` };
	// More than asked for is the model being generous, not a failure: keep the first max.
	return { value: cleaned.slice(0, max) };
}

function readText(value, { field, maxLength }) {
	const text = String(value ?? "").trim();
	if (!text) return { error: `${field} is empty` };
	if (text.length > maxLength) return { error: `${field} is over ${maxLength} characters` };
	return { value: text };
}

// The profile, or why it can't be used. The caller retries once on an error (lib/gtm/ai.js askForJson).
export function readProfile(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "the answer was not an object" };

	const pitch = readText(value.one_line_pitch, { field: "one_line_pitch", maxLength: MAX_PITCH_LENGTH });
	if (pitch.error) return { error: pitch.error };

	const customer = readText(value.target_customer, { field: "target_customer", maxLength: 300 });
	if (customer.error) return { error: customer.error };

	const differentiators = readText(value.differentiators, { field: "differentiators", maxLength: 1000 });
	if (differentiators.error) return { error: differentiators.error };

	const pains = readStrings(value.pains, { min: GTM_LIMITS.maxPains, max: GTM_LIMITS.maxPains, maxLength: 300 });
	if (pains.error) return { error: `pains ${pains.error}` };

	const keywords = readStrings(value.keywords, { min: GTM_LIMITS.minKeywords, max: GTM_LIMITS.maxKeywords, maxLength: 60 });
	if (keywords.error) return { error: `keywords ${keywords.error}` };

	// The only optional field: a model that is honestly unsure of where the customers are should be able to
	// say so, rather than inventing six subreddits.
	const communities = Array.isArray(value.suggested_communities)
		? value.suggested_communities.map((entry) => String(entry ?? "").trim()).filter(Boolean).slice(0, 6)
		: [];

	return {
		value: {
			one_line_pitch: pitch.value,
			target_customer: customer.value,
			pains: pains.value,
			differentiators: differentiators.value,
			// Lowercased here so the same keyword from two runs de-duplicates (the model is inconsistent
			// about capitalising them, and the radar searches on them).
			keywords: [...new Set(keywords.value.map((keyword) => keyword.toLowerCase()))],
			suggested_communities: communities,
		},
	};
}

export function readInterviewQuestions(value) {
	if (!value || typeof value !== "object") return { error: "the answer was not an object" };
	const questions = readStrings(value.questions, {
		min: GTM_LIMITS.minInterviewQuestions,
		max: GTM_LIMITS.maxInterviewQuestions,
		maxLength: 500,
	});
	if (questions.error) return { error: `questions ${questions.error}` };
	return { value: questions.value };
}

// The profile as it is stored on gtm_products: the AI speaks snake_case, the database camelCase.
export function toProductFields(profile) {
	return {
		oneLinePitch: profile.one_line_pitch,
		targetCustomer: profile.target_customer,
		pains: profile.pains,
		differentiators: profile.differentiators,
		keywords: profile.keywords,
	};
}

// And back, to show the AI what it last said when refining it.
export function fromProductFields(product) {
	return {
		one_line_pitch: product.oneLinePitch ?? "",
		target_customer: product.targetCustomer ?? "",
		pains: product.pains ?? [],
		differentiators: product.differentiators ?? "",
		keywords: product.keywords ?? [],
		suggested_communities: [],
	};
}
