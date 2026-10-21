import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_COLUMNS, CSV_HEADER_LINE, contactToCsvLine, escapeCsvCell } from "../lib/contacts-csv.js";
import { buildContactFilters, readContactFilters } from "../lib/contact-filter.js";

const workspaceId = "74f1a2b3c4d5e6f7a8b9c0d9";
const newsletterId = "74f1a2b3c4d5e6f7a8b9c0d2";

test("cells with commas, quotes or line breaks are quoted", () => {
	assert.equal(escapeCsvCell("a,b"), '"a,b"');
	assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
	assert.equal(escapeCsvCell("two\nlines"), '"two\nlines"');
	assert.equal(escapeCsvCell("plain"), "plain");
	assert.equal(escapeCsvCell(undefined), "");
	assert.equal(escapeCsvCell(0), "0");
});

test("a cell a spreadsheet would run as a formula gets a leading quote mark", () => {
	assert.equal(escapeCsvCell('=HYPERLINK("http://evil.test")'), `"'=HYPERLINK(""http://evil.test"")"`);
	assert.equal(escapeCsvCell("+1234"), "'+1234");
	assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
	assert.equal(escapeCsvCell("-2+3"), "'-2+3");
});

test("a contact becomes one line in the header's column order", () => {
	const line = contactToCsvLine(
		{
			email: "dana@example.com",
			firstName: "Dana",
			status: "active",
			source: "website",
			tags: ["vip", "paris"],
			subscribedAt: new Date("2026-10-11T08:00:00.000Z"),
			stats: { sent: 3, opens: 2, clicks: 1 },
			lastOpenAt: new Date("2026-10-12T09:30:00.000Z"),
		},
		"Avedis Notes"
	);
	assert.equal(
		line,
		"dana@example.com,Dana,active,Avedis Notes,website,vip;paris,2026-10-11T08:00:00.000Z,,3,2,1,2026-10-12T09:30:00.000Z"
	);
	assert.equal(line.split(",").length, CSV_COLUMNS.length);
	assert.equal(CSV_HEADER_LINE.split(",").length, CSV_COLUMNS.length);
});

test("a contact with nothing but an email still exports a full line", () => {
	const line = contactToCsvLine({ email: "a@example.com", status: "active" });
	assert.equal(line.split(",").length, CSV_COLUMNS.length);
	assert.ok(line.startsWith("a@example.com,,active,"));
});

test("filters are read from the address and invalid values are dropped", () => {
	const params = new URLSearchParams({ newsletter: newsletterId, status: "bounced", q: "  Dana@Ex " });
	assert.deepEqual(readContactFilters(params), { newsletterId, status: "bounced", query: "dana@ex" });
	assert.deepEqual(readContactFilters({ newsletter: "nope", status: "weird", q: 5 }), {
		newsletterId: null,
		status: null,
		query: "",
	});
});

test("the filter matches the email's start only, with regex characters escaped", () => {
	const { baseFilter, filter } = buildContactFilters({ workspaceId, newsletterId, status: "active", query: "a.b+c" });
	assert.equal(String(baseFilter.newsletterId), newsletterId);
	assert.equal(baseFilter.email.$regex, "^a\\.b\\+c");
	assert.equal(baseFilter.status, undefined);
	assert.equal(filter.status, "active");
	assert.deepEqual(buildContactFilters({ workspaceId, newsletterId: null, status: null, query: "" }).filter, { workspaceId });
	assert.throws(() => buildContactFilters({ newsletterId, status: null, query: "" }), /workspaceId/, "never unscoped");
});
