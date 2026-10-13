import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAddResult } from "../lib/contact-add.js";

const email = "a@example.com";

test("a new contact is reported as added", () => {
	assert.deepEqual(describeAddResult({ email, created: true, status: "active" }), {
		type: "success",
		message: "a@example.com added",
	});
});

test("an address already on the list is reported, not treated as an error", () => {
	for (const status of ["active", "dormant", "pending"]) {
		const { type, message } = describeAddResult({ email, created: false, status });
		assert.equal(type, "info");
		assert.match(message, /a@example\.com/);
	}
});

test("an address that opted out is never added back, and says so", () => {
	const { type, message } = describeAddResult({ email, created: false, status: "unsubscribed" });
	assert.equal(type, "error");
	assert.match(message, /unsubscribed and can't be added again/);
});

test("bounced and complained addresses are refused with their status", () => {
	for (const status of ["bounced", "complained"]) {
		const { type, message } = describeAddResult({ email, created: false, status });
		assert.equal(type, "error");
		assert.match(message, new RegExp(status));
	}
});

test("an unknown status still refuses the address", () => {
	const { type, message } = describeAddResult({ email, created: false });
	assert.equal(type, "error");
	assert.match(message, /blocked/);
});
