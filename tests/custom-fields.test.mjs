import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_FIELDS_PER_WORKSPACE,
	fieldKeyFromLabel,
	formatFieldValue,
	normalizeFieldValue,
	readFieldDefinition,
	readFieldValues,
} from "../lib/contact-fields.js";
import { applyMergeTags, findMergeTagKeys } from "../lib/merge-tags.js";

test("a label becomes a merge-tag key: lowercase, underscores, starting with a letter", () => {
	assert.equal(fieldKeyFromLabel("Renewal date"), "renewal_date");
	assert.equal(fieldKeyFromLabel("  Société / Plan! "), "societe_plan");
	assert.equal(fieldKeyFromLabel("2nd choice"), "nd_choice");
	assert.equal(fieldKeyFromLabel("A".repeat(60)).length, 30);
	assert.equal(fieldKeyFromLabel("!!!"), "");
});

test("a field definition is checked: a name, a type, nothing reserved, no duplicates, a limit", () => {
	assert.deepEqual(readFieldDefinition({ label: " Renewal  date ", type: "date" }), { key: "renewal_date", label: "Renewal date", type: "date" });
	assert.match(readFieldDefinition({ label: "", type: "text" }).error, /Give the field a name/);
	assert.match(readFieldDefinition({ label: "x".repeat(41), type: "text" }).error, /under 40/);
	assert.match(readFieldDefinition({ label: "Plan", type: "money" }).error, /Pick a type/);
	assert.match(readFieldDefinition({ label: "!!!", type: "text" }).error, /letters/);
	assert.match(readFieldDefinition({ label: "Email", type: "text" }).error, /already used for something else/);
	assert.match(readFieldDefinition({ label: "First name", type: "text" }).error, /already used/);
	assert.match(readFieldDefinition({ label: "Plan", type: "text" }, ["plan"]).error, /already a field called plan/);
	assert.match(readFieldDefinition({ label: "Another", type: "text" }, Array.from({ length: MAX_FIELDS_PER_WORKSPACE }, (_, index) => `f${index}`)).error, /25 fields/);
});

test("values are checked by type: numbers, dates and text, empty clears, nonsense is refused", () => {
	assert.deepEqual(normalizeFieldValue("text", "  Pro plan "), { value: "Pro plan" });
	assert.deepEqual(normalizeFieldValue("text", "a\nb"), { value: "a b" });
	assert.deepEqual(normalizeFieldValue("text", ""), { value: null });
	assert.deepEqual(normalizeFieldValue("text", null), { value: null });
	assert.match(normalizeFieldValue("text", "x".repeat(201)).error, /under 200/);
	assert.match(normalizeFieldValue("text", { a: 1 }).error, /Enter text/);
	assert.deepEqual(normalizeFieldValue("number", "1,250.5"), { value: 1250.5 });
	assert.deepEqual(normalizeFieldValue("number", 3), { value: 3 });
	assert.match(normalizeFieldValue("number", "lots").error, /Enter a number/);
	assert.match(normalizeFieldValue("number", "1e99").error, /Enter a number/);
	assert.deepEqual(normalizeFieldValue("date", "2026-10-23"), { value: "2026-10-23" });
	assert.deepEqual(normalizeFieldValue("date", "October 23, 2026"), { value: "2026-10-23" });
	assert.match(normalizeFieldValue("date", "2026-02-31").error, /Enter a date/);
	assert.match(normalizeFieldValue("date", "someday").error, /Enter a date/);
});

test("a set of values is read against the definitions, and an unknown key is an error", () => {
	const definitions = [{ key: "plan", label: "Plan", type: "text" }, { key: "seats", label: "Seats", type: "number" }];
	assert.deepEqual(readFieldValues(definitions, { plan: "Pro", seats: "12", }), { values: { plan: "Pro", seats: 12 } });
	assert.deepEqual(readFieldValues(definitions, { plan: "" }), { values: { plan: null } });
	assert.deepEqual(readFieldValues(definitions, undefined), { values: {} });
	assert.equal(readFieldValues(definitions, { plans: "Pro" }).error, "Unknown field: plans");
	assert.equal(readFieldValues(definitions, { seats: "many" }).error, "Seats: Enter a number");
});

test("stored values print naturally in an email", () => {
	assert.equal(formatFieldValue(1250), "1,250");
	assert.equal(formatFieldValue(3.14159265), "3.141593");
	assert.equal(formatFieldValue("2026-10-23"), "October 23, 2026");
	assert.equal(formatFieldValue("Pro plan"), "Pro plan");
	assert.equal(formatFieldValue(null), "");
	assert.equal(formatFieldValue(""), "");
});

test("custom tags fill in with the contact's value, a fallback, or nothing, and undefined tags stay as written", () => {
	const person = { firstName: "Dana", fields: { plan: "Pro", seats: 12, renews: "2026-12-01" }, fieldKeys: ["plan", "seats", "renews", "company"] };
	assert.equal(applyMergeTags("{{plan}} / {{seats}} seats, renews {{renews}}", person), "Pro / 12 seats, renews December 1, 2026");
	assert.equal(applyMergeTags("At {{company|your company}}", person), "At your company", "defined, no value: the fallback");
	assert.equal(applyMergeTags("At [{{company}}]", person), "At []", "defined, no value, no fallback: nothing");
	assert.equal(applyMergeTags("{{ PLAN | x }}", person), "Pro", "case and spaces don't matter");
	assert.equal(applyMergeTags("Hello {{last_name}} {{frist_name}}", person), "Hello {{last_name}} {{frist_name}}", "unknown tags are left alone");
	assert.equal(applyMergeTags("{{plan}}", { fields: { plan: '<b onclick="x">' } }, { html: true }), "&lt;b onclick=&quot;x&quot;&gt;");
	assert.equal(applyMergeTags("{{plan}}", { fields: { plan: "a\r\nBcc: x" } }), "a Bcc: x");
	assert.equal(applyMergeTags("{{plan}}", { fieldKeys: ["plan"] }), "");
});

test("the keys used in a text are listed once each, for the warning about unknown tags", () => {
	assert.deepEqual(findMergeTagKeys("Hi {{first_name}}, {{plan}} and {{ Plan | x }} and {{seats}}"), ["first_name", "plan", "seats"]);
	assert.deepEqual(findMergeTagKeys("No tags {{ }} or {{1abc}}"), []);
	assert.deepEqual(findMergeTagKeys(undefined), []);
});
