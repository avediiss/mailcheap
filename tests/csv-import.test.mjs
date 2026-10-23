import assert from "node:assert/strict";
import { test } from "node:test";
import {
	mapColumns,
	normalizeImportRow,
	normalizeRate,
	normalizeStatus,
	sanitizeImportRow,
} from "../lib/csv-import.js";

test("maps common export headers", () => {
	const columns = mapColumns(["Email", "Status", "Created At", "Open Rate", "Click Through Rate"]);
	assert.deepEqual(columns, {
		email: "Email",
		status: "Status",
		subscribedAt: "Created At",
		emailsReceived: null,
		openRate: "Open Rate",
		clickRate: "Click Through Rate",
		firstName: null,
		tags: null,
		fields: {},
	});
});

test("maps statuses and never guesses active for unknown values", () => {
	assert.equal(normalizeStatus("active"), "active");
	assert.equal(normalizeStatus("inactive"), "unsubscribed");
	assert.equal(normalizeStatus("Invalid"), "bounced");
	assert.equal(normalizeStatus("pending"), "dormant");
	assert.equal(normalizeStatus("something-new"), "dormant");
	assert.equal(normalizeStatus(""), "active");
});

test("normalizes rates written as percents or fractions", () => {
	assert.equal(normalizeRate("45.5%"), 0.455);
	assert.equal(normalizeRate("45.5"), 0.455);
	assert.equal(normalizeRate("0.3"), 0.3);
	assert.equal(normalizeRate(""), undefined);
	assert.equal(normalizeRate("abc"), undefined);
	assert.equal(normalizeRate("250%"), 1);
});

test("normalizes a row and applies a stricter status override only", () => {
	const columns = mapColumns(["email", "status", "created_at"]);
	const active = normalizeImportRow(
		{ email: " Jane@Example.com ", status: "active", created_at: "2024-01-02" },
		columns,
		{ status: "dormant" }
	);
	assert.equal(active.email, "jane@example.com");
	assert.equal(active.status, "dormant");
	assert.equal(active.subscribedAt, new Date("2024-01-02").toISOString());

	const unsubscribed = normalizeImportRow({ email: "reader@example.com", status: "inactive" }, columns, {
		status: "dormant",
	});
	assert.equal(unsubscribed.status, "unsubscribed");
	assert.equal(normalizeImportRow({ email: "not-an-email" }, columns), null);
});

test("sanitizes rows coming from the browser", () => {
	assert.equal(sanitizeImportRow({ email: "reader@example.com", status: "admin" }), null);
	assert.equal(sanitizeImportRow({ email: "reader@example.com", status: "__proto__" }), null);
	assert.equal(sanitizeImportRow(null), null);

	const row = sanitizeImportRow({
		email: "Reader@Example.com",
		status: "active",
		subscribedAt: "nope",
		openRate: 7,
		clickRate: -1,
	});
	assert.deepEqual(row, {
		email: "reader@example.com",
		status: "active",
		subscribedAt: undefined,
		emailsReceived: undefined,
		openRate: 1,
		clickRate: undefined,
	});
});

test("columns named like a custom field are mapped to it, once, and their values come with the row", () => {
	const fieldDefs = [{ key: "plan", label: "Plan", type: "text" }, { key: "renewal_date", label: "Renewal date", type: "date" }];
	const columns = mapColumns(["Email", "Plan", "Renewal Date", "Name"], fieldDefs);
	assert.deepEqual(columns.fields, { plan: "Plan", renewal_date: "Renewal Date" });
	assert.equal(columns.firstName, "Name", "a built-in column is never taken by a field");
	const row = normalizeImportRow({ Email: "a@x.test", Plan: " Pro ", "Renewal Date": "2026-12-01", Name: "Dana" }, columns);
	assert.deepEqual(row.fields, { plan: "Pro", renewal_date: "2026-12-01" });
	assert.equal(normalizeImportRow({ Email: "a@x.test", Plan: "", "Renewal Date": "  " }, columns).fields, undefined, "empty cells add nothing");
	assert.deepEqual(mapColumns(["Email", "Plan"]).fields, {}, "no definitions, no mapping");
});

test("field values from the browser are cleaned again on the server", () => {
	const row = sanitizeImportRow({ email: "a@x.test", status: "active", fields: { plan: " Pro ", seats: 12, Bad_Key: "x", "x y": "z", nested: { a: 1 }, empty: "  ", inf: Infinity } });
	assert.deepEqual(row.fields, { plan: "Pro", seats: 12 });
	assert.equal(sanitizeImportRow({ email: "a@x.test", status: "active", fields: "plan=Pro" }).fields, undefined);
	assert.equal(sanitizeImportRow({ email: "a@x.test", status: "active", fields: ["a"] }).fields, undefined);
	assert.equal(Object.keys(sanitizeImportRow({ email: "a@x.test", status: "active", fields: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${index}`, "v"])) }).fields).length, 25);
});
