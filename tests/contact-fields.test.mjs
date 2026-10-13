import assert from "node:assert/strict";
import { test } from "node:test";
import { getErasedEmail, getSuppressionReasonOnDelete } from "../lib/contact-delete.js";
import { getContactWrites } from "../lib/contact-import.js";
import { mapColumns, normalizeImportRow, normalizeTags, sanitizeImportRow } from "../lib/csv-import.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { MAX_NOTICES_PER_WINDOW, describeSignup, getSignupNotice } from "../lib/signup-notice-rules.js";

process.env.SESSION_SECRET ||= "test-secret-for-contact-fields";
process.env.APP_URL ||= "https://mailcheap.test";

const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";
const newsletter = { _id: newsletterId, name: "Field notes", fromEmail: "hi@news.example.org" };

test("tags are lowercased, cleaned, deduplicated and capped", () => {
	assert.deepEqual(normalizeTags("VIP; Paris, press | vip"), ["vip", "paris", "press"]);
	assert.deepEqual(normalizeTags(["  Press  Kit ", "a/b<script>", ""]), ["press kit", "abscript"]);
	assert.deepEqual(normalizeTags(undefined), []);
	assert.equal(normalizeTags("x".repeat(100))[0].length, 40);
	assert.equal(normalizeTags(Array.from({ length: 30 }, (_, index) => `tag${index}`)).length, 10);
});

test("an import file's name and tags columns are found, and the first name is kept", () => {
	const columns = mapColumns(["Email", "Full name", "Labels"]);
	assert.equal(columns.firstName, "Full name");
	assert.equal(columns.tags, "Labels");
	const row = normalizeImportRow({ Email: "Dana@Example.com", "Full name": "Dana Smith", Labels: "VIP, Paris" }, columns);
	assert.equal(row.email, "dana@example.com");
	assert.equal(row.firstName, "Dana");
	assert.deepEqual(row.tags, ["vip", "paris"]);
});

test("a row without a name or tags has neither field, as before they existed", () => {
	const columns = mapColumns(["email"]);
	const row = normalizeImportRow({ email: "a@example.com" }, columns);
	assert.equal(Object.hasOwn(row, "firstName"), false);
	assert.equal(Object.hasOwn(row, "tags"), false);
	const clean = sanitizeImportRow({ email: "a@example.com", status: "active" });
	assert.equal(Object.hasOwn(clean, "firstName"), false);
	assert.equal(Object.hasOwn(clean, "tags"), false);
});

test("the server re-checks names and tags from the browser", () => {
	const row = sanitizeImportRow({ email: "a@example.com", status: "active", firstName: "Dana Smith", tags: "VIP;<b>x</b>" });
	assert.equal(row.firstName, "Dana");
	assert.deepEqual(row.tags, ["vip", "bxb"], "punctuation is stripped, so markup can't be stored in a tag");
});

test("a new contact takes the file's name, and tags are added to new and existing contacts", () => {
	const [write] = getContactWrites({
		newsletterId,
		contacts: [{ email: "a@example.com", status: "active", firstName: "Dana", tags: ["vip"] }],
		source: "manual",
	});
	assert.equal(write.updateOne.update.$setOnInsert.firstName, "Dana");
	assert.deepEqual(write.updateOne.update.$addToSet, { tags: { $each: ["vip"] } });
	const [plain] = getContactWrites({ newsletterId, contacts: [{ email: "b@example.com", status: "active" }], source: "import" });
	assert.equal(Object.hasOwn(plain.updateOne.update.$setOnInsert, "firstName"), false);
	assert.equal(Object.hasOwn(plain.updateOne.update, "$addToSet"), false);
});

test("an email is personalized per recipient, in the subject and the body", () => {
	const campaign = {
		format: "markdown",
		markdown: "Hi {{first_name}},\n\nThanks for reading.",
		subject: "News for {{first_name|friend}}",
		previewText: "",
	};
	const named = buildRecipientEmail({ campaign, newsletter, contact: { _id: newsletterId, email: "a@example.com", firstName: "Dana" } });
	assert.equal(named.subject, "News for Dana");
	assert.ok(named.html.includes("Hi Dana,"));
	assert.ok(named.text.includes("Hi Dana,"));
	assert.ok(!named.html.includes("{{"));

	const anonymous = buildRecipientEmail({ campaign, newsletter, contact: { _id: newsletterId, email: "b@example.com" } });
	assert.equal(anonymous.subject, "News for friend");
	assert.ok(anonymous.html.includes("Hi there,"));
});

test("a hostile first name can't inject HTML or headers", () => {
	const campaign = { format: "markdown", markdown: "Hi {{first_name}}", subject: "Hi {{first_name}}", previewText: "" };
	const email = buildRecipientEmail({
		campaign,
		newsletter,
		contact: { _id: newsletterId, email: "a@example.com", firstName: '<img src=x onerror="a">\r\nBcc: x@y.z' },
	});
	assert.ok(!email.html.includes("<img src=x"), "markup is escaped");
	assert.ok(email.html.includes("&lt;img"));
	assert.ok(!/[\r\n]/.test(email.subject), "the subject has no line break");
});

test("signup notices: one each, one 'many signups' notice, then silence", () => {
	assert.equal(getSignupNotice(1), "each");
	assert.equal(getSignupNotice(MAX_NOTICES_PER_WINDOW), "each");
	assert.equal(getSignupNotice(MAX_NOTICES_PER_WINDOW + 1), "burst");
	assert.equal(getSignupNotice(MAX_NOTICES_PER_WINDOW + 2), "none");
	assert.equal(getSignupNotice(500), "none");
	assert.equal(
		describeSignup({ email: "a@example.com", firstName: "Dana", newsletterName: "Field notes", source: "website" }),
		"a@example.com (Dana) subscribed to Field notes via website."
	);
	assert.equal(describeSignup({ email: "a@example.com", newsletterName: "Field notes" }), "a@example.com subscribed to Field notes.");
});

test("deleting a contact keeps opt-outs off the list for good, and plain contacts are simply erased", () => {
	assert.equal(getSuppressionReasonOnDelete("unsubscribed"), "manual");
	assert.equal(getSuppressionReasonOnDelete("bounced"), "bounce");
	assert.equal(getSuppressionReasonOnDelete("complained"), "complaint");
	for (const status of ["active", "pending", "dormant", undefined]) {
		assert.equal(getSuppressionReasonOnDelete(status), null);
	}
	assert.equal(getErasedEmail("abc123"), "deleted-abc123@deleted.invalid");
});
