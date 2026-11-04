import { GTM_LIMITS } from "./config.js";

// Three to five things the founder actually wrote, used verbatim in the drafting prompt. The minimum length
// is the point: a one-line sample teaches a model nothing about how someone writes, and a founder who gives
// five of them gets replies that sound like theirs instead of like a chatbot.

export const VOICE_SAMPLE_RULES = {
	min: GTM_LIMITS.minVoiceSamples,
	max: GTM_LIMITS.maxVoiceSamples,
	minLength: GTM_LIMITS.minVoiceSampleLength,
	maxLength: GTM_LIMITS.maxVoiceSampleLength,
};

export function readVoiceSample(value) {
	const text = String(value ?? "").trim();
	if (!text) return { error: "This one is empty" };
	if (text.length < VOICE_SAMPLE_RULES.minLength) {
		return { error: `Too short to copy a voice from — ${VOICE_SAMPLE_RULES.minLength} characters or more (this is ${text.length})` };
	}
	if (text.length > VOICE_SAMPLE_RULES.maxLength) {
		return { error: `Too long — keep it under ${VOICE_SAMPLE_RULES.maxLength} characters` };
	}
	return { value: text };
}

// The whole set, checked together: the count is a property of the set, not of any one sample.
export function readVoiceSamples(values) {
	const texts = [];
	const problems = [];
	const seen = new Set();

	for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
		// A blank box the founder left alone is not an error; one they typed two words into is.
		if (!String(value ?? "").trim()) continue;

		const read = readVoiceSample(value);
		if (read.error) {
			problems.push({ index, error: read.error });
			continue;
		}
		// The same text pasted twice teaches the model nothing new and crowds the prompt.
		const key = read.value.replace(/\s+/g, " ").toLowerCase();
		if (seen.has(key)) {
			problems.push({ index, error: "This is the same as another sample" });
			continue;
		}
		seen.add(key);
		texts.push(read.value);
	}

	if (problems.length > 0) return { problems };
	if (texts.length < VOICE_SAMPLE_RULES.min) {
		return { error: `Add ${VOICE_SAMPLE_RULES.min} or more samples (you have ${texts.length})` };
	}
	if (texts.length > VOICE_SAMPLE_RULES.max) {
		return { error: `Keep it to ${VOICE_SAMPLE_RULES.max} samples` };
	}
	return { value: texts };
}
