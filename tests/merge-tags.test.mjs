import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMergeTags, hasMergeTags, toFirstName } from "../lib/merge-tags.js";

test("the first name replaces the tag", () => {
	assert.equal(applyMergeTags("Hi {{first_name}},", { firstName: "Dana" }), "Hi Dana,");
	assert.equal(applyMergeTags("Hi {{ first_name }},", { firstName: "Dana" }), "Hi Dana,");
	assert.equal(applyMergeTags("{{FIRST_NAME}} and {{first_name}}", { firstName: "Dana" }), "Dana and Dana");
});

test("without a first name the fallback after the bar is used, then 'there'", () => {
	assert.equal(applyMergeTags("Hi {{first_name|friend}},", {}), "Hi friend,");
	assert.equal(applyMergeTags("Hi {{first_name|friend}},", { firstName: "  " }), "Hi friend,");
	assert.equal(applyMergeTags("Hi {{first_name}},", { firstName: "" }), "Hi there,");
	assert.equal(applyMergeTags("Hi {{first_name}},"), "Hi there,");
});

test("a name is escaped in HTML so it can't inject markup", () => {
	const html = applyMergeTags("<p>Hi {{first_name}}</p>", { firstName: '<img src=x onerror="a">' }, { html: true });
	assert.equal(html, "<p>Hi &lt;img src=x onerror=&quot;a&quot;&gt;</p>");
});

test("a name can't add line breaks, so it can't add email headers to a subject", () => {
	assert.equal(applyMergeTags("Hi {{first_name}}", { firstName: "Dana\r\nBcc: x@y.z" }), "Hi Dana Bcc: x@y.z");
});

test("text without tags comes back untouched, and unknown tags are left alone", () => {
	assert.equal(applyMergeTags("No tags here", { firstName: "Dana" }), "No tags here");
	assert.equal(applyMergeTags("Hello {{last_name}}", { firstName: "Dana" }), "Hello {{last_name}}");
	assert.equal(applyMergeTags(undefined, {}), undefined);
});

test("hasMergeTags tells whether a text personalizes", () => {
	assert.equal(hasMergeTags("Hi {{first_name}}"), true);
	assert.equal(hasMergeTags("Hi {{first_name|you}}"), true);
	assert.equal(hasMergeTags("Hi there"), false);
	assert.equal(hasMergeTags("Hi {{first_name"), false);
});

test("a full name becomes a first name", () => {
	assert.equal(toFirstName("Dana Smith"), "Dana");
	assert.equal(toFirstName("  Dana  "), "Dana");
	assert.equal(toFirstName("Dana\nBcc: x"), "Dana");
	assert.equal(toFirstName(""), "");
	assert.equal(toFirstName(undefined), "");
	assert.equal(toFirstName("x".repeat(200)).length, 60);
});
