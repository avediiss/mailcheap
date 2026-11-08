import assert from "node:assert/strict";
import { test } from "node:test";
import {
	INTERVIEW_JSON_SCHEMA,
	PROFILE_JSON_SCHEMA,
	fromProductFields,
	parseJsonAnswer,
	readInterviewQuestions,
	readProfile,
	toProductFields,
} from "../lib/gtm/profile.js";

const keywords = ["invoicing", "late payments", "freelance accounting", "chasing invoices", "payment reminders", "self-employed", "contractor billing", "cash flow"];

function validProfile(overrides = {}) {
	return {
		one_line_pitch: "Invoicing that chases late payers for freelancers.",
		target_customer: "Freelance designers who bill a handful of clients a month.",
		pains: ["Clients pay late.", "Chasing feels rude.", "Spreadsheets lose track."],
		differentiators: "It sends the reminders for you, in your own words.",
		keywords,
		suggested_communities: ["r/freelance"],
		...overrides,
	};
}

test("a well-formed profile comes back cleaned up", () => {
	const { value, error } = readProfile(validProfile());

	assert.equal(error, undefined);
	assert.equal(value.pains.length, 3);
	assert.equal(value.keywords.length, 8);
});

test("keywords are lowercased and de-duplicated, since the radar searches on them", () => {
	const { value } = readProfile(validProfile({ keywords: [...keywords, "INVOICING", "Invoicing"] }));

	assert.ok(value.keywords.includes("invoicing"));
	assert.equal(value.keywords.filter((word) => word === "invoicing").length, 1);
});

test("whitespace and empty entries are cleaned out of the lists", () => {
	const { value } = readProfile(validProfile({ pains: ["  Clients pay late.  ", "", "Chasing feels rude.", "   ", "Spreadsheets lose track."] }));

	assert.deepEqual(value.pains, ["Clients pay late.", "Chasing feels rude.", "Spreadsheets lose track."]);
});

test("too few pains or keywords is a failure, and says which", () => {
	assert.match(readProfile(validProfile({ pains: ["Only one."] })).error, /pains has 1, needs at least 3/);
	assert.match(readProfile(validProfile({ keywords: ["one", "two"] })).error, /keywords has 2, needs at least 8/);
});

test("more than asked for is kept, trimmed — that is the model being generous, not wrong", () => {
	const many = Array.from({ length: 30 }, (_, index) => `keyword ${index}`);
	const { value, error } = readProfile(validProfile({ keywords: many }));

	assert.equal(error, undefined);
	assert.equal(value.keywords.length, 15);
});

test("a missing or empty text field is a failure, named", () => {
	assert.match(readProfile(validProfile({ one_line_pitch: "" })).error, /one_line_pitch is empty/);
	assert.match(readProfile(validProfile({ target_customer: "   " })).error, /target_customer is empty/);
	assert.match(readProfile(validProfile({ differentiators: undefined })).error, /differentiators is empty/);
});

test("an absurdly long field is a failure rather than something stored and truncated", () => {
	assert.match(readProfile(validProfile({ one_line_pitch: "x".repeat(400) })).error, /over 300 characters/);
});

test("suggested communities are optional: a model unsure where the customers are may say so", () => {
	assert.deepEqual(readProfile(validProfile({ suggested_communities: [] })).value.suggested_communities, []);
	assert.deepEqual(readProfile(validProfile({ suggested_communities: undefined })).value.suggested_communities, []);
});

test("what isn't an object at all is refused", () => {
	for (const value of [null, undefined, "a string", 42, ["a", "list"]]) {
		assert.match(readProfile(value).error, /was not an object/, JSON.stringify(value));
	}
});

test("JSON wrapped in a code fence is unwrapped rather than costing a retry", () => {
	// Models do this even when told not to, and re-asking for something this mechanical is a waste.
	assert.deepEqual(parseJsonAnswer('```json\n{"a":1}\n```').value, { a: 1 });
	assert.deepEqual(parseJsonAnswer("```\n{\"a\":1}\n```").value, { a: 1 });
	assert.deepEqual(parseJsonAnswer('  {"a":1}  ').value, { a: 1 });
});

test("an answer that is not JSON is reported, not thrown", () => {
	assert.match(parseJsonAnswer("I'd be happy to help!").error, /not valid JSON/);
	assert.match(parseJsonAnswer('{"truncated":').error, /not valid JSON/);
	assert.match(parseJsonAnswer("").error, /returned nothing/);
});

test("the interview must come back as three or four questions", () => {
	assert.deepEqual(readInterviewQuestions({ questions: ["A?", "B?", "C?"] }).value, ["A?", "B?", "C?"]);
	assert.match(readInterviewQuestions({ questions: ["A?", "B?"] }).error, /needs at least 3/);
	assert.match(readInterviewQuestions({}).error, /is not a list/);
	// Five is the model being generous; the extra is dropped rather than failing the step.
	assert.equal(readInterviewQuestions({ questions: ["A?", "B?", "C?", "D?", "E?"] }).value.length, 4);
});

test("the schema fixes the shape and asks for no counts", () => {
	// The API rejects the whole request with a 400 when a structured-output schema sets minItems above 1,
	// so the counts are the validator's job and must stay out of here. Nothing local caught this until a
	// live call failed on it: a stub accepts any schema you hand it.
	for (const [name, property] of Object.entries(PROFILE_JSON_SCHEMA.properties)) {
		if (property.type !== "array") continue;
		assert.equal(property.minItems, undefined, `${name} must not constrain minItems`);
		assert.equal(property.maxItems, undefined, `${name} must not constrain maxItems`);
	}
	assert.equal(INTERVIEW_JSON_SCHEMA.properties.questions.minItems, undefined);
	assert.equal(INTERVIEW_JSON_SCHEMA.properties.questions.maxItems, undefined);

	// The shape, though, is still the schema's to fix, and it has to be the shape the validator reads.
	assert.equal(PROFILE_JSON_SCHEMA.additionalProperties, false);
	assert.deepEqual(PROFILE_JSON_SCHEMA.required.sort(), Object.keys(PROFILE_JSON_SCHEMA.properties).sort());
	assert.equal(PROFILE_JSON_SCHEMA.properties.pains.items.type, "string");
	assert.equal(PROFILE_JSON_SCHEMA.properties.keywords.items.type, "string");
});

test("the counts the schema no longer carries are still enforced", () => {
	// The other half of the pair above: with the bounds gone from the schema, these are all that hold an
	// answer to its counts.
	assert.match(readProfile(validProfile({ pains: ["Only one."] })).error, /pains/);
	assert.match(readProfile(validProfile({ keywords: ["one", "two"] })).error, /keywords/);
	assert.match(readInterviewQuestions({ questions: ["A?", "B?"] }).error, /needs at least 3/);
});

test("the profile converts to the database's field names and back", () => {
	const { value } = readProfile(validProfile());
	const fields = toProductFields(value);

	assert.equal(fields.oneLinePitch, value.one_line_pitch);
	assert.equal(fields.targetCustomer, value.target_customer);
	assert.deepEqual(fields.keywords, value.keywords);
	// Round-tripped, so the AI is shown what it last said when refining it.
	const back = fromProductFields(fields);
	assert.equal(back.one_line_pitch, value.one_line_pitch);
	assert.deepEqual(back.pains, value.pains);
});

test("a product with nothing filled in yet round-trips to empty, not undefined", () => {
	const back = fromProductFields({});
	assert.equal(back.one_line_pitch, "");
	assert.deepEqual(back.pains, []);
	assert.deepEqual(back.keywords, []);
});
