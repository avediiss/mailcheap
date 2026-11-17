import assert from "node:assert/strict";
import { test } from "node:test";
import { VOICE_SAMPLE_RULES, readVoiceSample, readVoiceSamples } from "../lib/gtm/voice-samples.js";

// Comfortably over the 100-character minimum, whatever the distinguishing word is.
const sample = (word) => `${word}: the kind of thing the founder actually wrote, long enough to hear a voice in it.`.padEnd(120, ".");

test("a sample has to be long enough to copy a voice from", () => {
	assert.equal(readVoiceSample("Too short.").value, undefined);
	assert.match(readVoiceSample("Too short.").error, /100 characters or more \(this is 10\)/);
	assert.equal(readVoiceSample(sample("alpha")).value, sample("alpha"));
});

test("an empty box and a too-short one are different problems", () => {
	assert.match(readVoiceSample("").error, /empty/);
	assert.match(readVoiceSample("   ").error, /empty/);
	assert.match(readVoiceSample("Three words here.").error, /Too short/);
});

test("an enormous paste is refused rather than stored", () => {
	assert.match(readVoiceSample("x".repeat(6000)).error, /Too long/);
});

test("three to five samples are accepted", () => {
	for (const count of [3, 4, 5]) {
		const texts = Array.from({ length: count }, (_, index) => sample(`word${index}`));
		assert.equal(readVoiceSamples(texts).value.length, count, `${count} samples`);
	}
});

test("fewer than three says how many are there", () => {
	assert.match(readVoiceSamples([sample("a"), sample("b")]).error, /3 or more samples \(you have 2\)/);
	assert.match(readVoiceSamples([]).error, /you have 0/);
});

test("more than five is refused", () => {
	const texts = Array.from({ length: 6 }, (_, index) => sample(`word${index}`));
	assert.match(readVoiceSamples(texts).error, /Keep it to 5/);
});

test("a blank box the founder left alone is skipped, not an error", () => {
	// The form shows five boxes; filling three of them is a complete answer.
	const result = readVoiceSamples([sample("a"), "", sample("b"), "   ", sample("c")]);
	assert.equal(result.value.length, 3);
});

test("a box with two words in it is an error, and says which box", () => {
	const result = readVoiceSamples([sample("a"), "nope", sample("b"), sample("c")]);

	assert.equal(result.value, undefined);
	assert.equal(result.problems.length, 1);
	assert.equal(result.problems[0].index, 1, "the second box");
	assert.match(result.problems[0].error, /Too short/);
});

test("the same text twice is reported, since it teaches the model nothing new", () => {
	const repeated = sample("same");
	const result = readVoiceSamples([repeated, repeated, sample("other"), sample("third")]);

	assert.equal(result.problems.length, 1);
	assert.match(result.problems[0].error, /same as another sample/);
});

test("the same text with different spacing still counts as a duplicate", () => {
	const text = sample("same");
	const result = readVoiceSamples([text, `  ${text.replace(/ /g, "  ")}  `, sample("other"), sample("third")]);

	assert.equal(result.problems?.length, 1);
});

test("the rules are the ones the schema and the form share", () => {
	assert.deepEqual(VOICE_SAMPLE_RULES, { min: 3, max: 5, minLength: 100, maxLength: 5000 });
});

test("a list that isn't a list gives a reason, not a crash", () => {
	assert.ok(readVoiceSamples(undefined).error);
	assert.ok(readVoiceSamples("one long string").error);
});
