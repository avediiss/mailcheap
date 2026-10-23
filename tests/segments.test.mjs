import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CONDITIONS, buildSegmentFilter, describeSegmentRules, getSegmentFields, readCondition, readSegment } from "../lib/segments.js";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const DAY = 86_400_000;
const fieldDefs = [
	{ key: "plan", label: "Plan", type: "text" },
	{ key: "seats", label: "Seats", type: "number" },
	{ key: "renews", label: "Renewal date", type: "date" },
];

test("what a rule can ask about: built-in things, and the workspace's own fields by type", () => {
	const fields = getSegmentFields(fieldDefs);
	assert.deepEqual(fields.tag.ops, ["has", "hasNot"]);
	assert.deepEqual(fields["field:seats"].ops, ["is", "greaterThan", "lessThan", "isSet", "isNotSet"]);
	assert.ok(fields["field:renews"].ops.includes("inNext"), "upcoming renewals");
	assert.equal(fields["field:plan"].label, "Plan");
	assert.equal(fields.nothing, undefined);
});

test("a rule is checked: it must exist, allow that op, and have a value of the right kind", () => {
	const fields = getSegmentFields(fieldDefs);
	assert.deepEqual(readCondition({ field: "tag", op: "has", value: "  VIP  " }, fields), { field: "tag", op: "has", value: "vip" });
	assert.deepEqual(readCondition({ field: "opened", op: "never", value: "ignored" }, fields), { field: "opened", op: "never" });
	assert.deepEqual(readCondition({ field: "opened", op: "inLast", value: "30" }, fields), { field: "opened", op: "inLast", value: 30 });
	assert.deepEqual(readCondition({ field: "field:seats", op: "greaterThan", value: "1,200" }, fields), { field: "field:seats", op: "greaterThan", value: 1200 });
	assert.deepEqual(readCondition({ field: "subscribed", op: "before", value: "2026-01-31" }, fields), { field: "subscribed", op: "before", value: "2026-01-31" });
	assert.match(readCondition({ field: "colour", op: "is", value: "x" }, fields).error, /doesn't exist/);
	assert.match(readCondition({ field: "tag", op: "contains", value: "x" }, fields).error, /Tag can't be "contains"/);
	assert.match(readCondition({ field: "tag", op: "has", value: "  " }, fields).error, /enter a value/);
	assert.match(readCondition({ field: "tag", op: "has", value: "x".repeat(101) }, fields).error, /under 100/);
	assert.match(readCondition({ field: "opened", op: "inLast", value: "0" }, fields).error, /1 to 3650/);
	assert.match(readCondition({ field: "opened", op: "inLast", value: "2.5" }, fields).error, /1 to 3650/);
	assert.match(readCondition({ field: "received", op: "atLeast", value: "" }, fields).error, /enter a number/);
	assert.match(readCondition({ field: "subscribed", op: "after", value: "2026-02-31" }, fields).error, /enter a date/);
});

test("a segment needs a name and one to eight good rules, and 'any' is the only alternative to 'all'", () => {
	const good = { field: "tag", op: "has", value: "vip" };
	assert.deepEqual(readSegment({ name: "  VIPs ", match: "any", conditions: [good] }), { name: "VIPs", match: "any", conditions: [good] });
	assert.equal(readSegment({ name: "x", match: "whatever", conditions: [good] }).match, "all");
	assert.match(readSegment({ name: "", conditions: [good] }).error, /Give the segment a name/);
	assert.match(readSegment({ name: "x".repeat(61), conditions: [good] }).error, /under 60/);
	assert.match(readSegment({ name: "x", conditions: [] }).error, /at least one rule/);
	assert.match(readSegment({ name: "x" }).error, /at least one rule/);
	assert.match(readSegment({ name: "x", conditions: Array.from({ length: MAX_CONDITIONS + 1 }, () => good) }).error, /8 rules/);
	assert.match(readSegment({ name: "x", conditions: [good, { field: "tag", op: "has", value: "" }] }).error, /enter a value/);
	assert.match(readSegment({ name: "x", conditions: [{ field: "field:gone", op: "is", value: "a" }] }, fieldDefs).error, /doesn't exist/);
});

test("the filter for each kind of rule", () => {
	const filter = (condition) => buildSegmentFilter({ match: "all", conditions: [condition] }, { now: NOW }).$and[0];
	assert.deepEqual(filter({ field: "tag", op: "has", value: "vip" }), { tags: "vip" });
	assert.deepEqual(filter({ field: "tag", op: "hasNot", value: "vip" }), { tags: { $ne: "vip" } });
	assert.deepEqual(filter({ field: "source", op: "isNot", value: "import" }), { source: { $ne: "import" } });
	assert.deepEqual(filter({ field: "email", op: "endsWith", value: "@acme.io" }), { email: { $regex: "@acme\\.io$", $options: "i" } });
	assert.deepEqual(filter({ field: "email", op: "contains", value: "a.b" }), { email: { $regex: "a\\.b", $options: "i" } }, "dots are literal");
	assert.deepEqual(filter({ field: "opened", op: "inLast", value: 30 }), { lastOpenAt: { $gte: new Date(NOW - 30 * DAY) } });
	assert.deepEqual(filter({ field: "opened", op: "notInLast", value: 30 }), { $or: [{ lastOpenAt: null }, { lastOpenAt: { $lt: new Date(NOW - 30 * DAY) } }] });
	assert.deepEqual(filter({ field: "clicked", op: "never" }), { lastClickAt: null });
	assert.deepEqual(filter({ field: "subscribed", op: "after", value: "2026-01-01" }), { subscribedAt: { $gte: new Date("2026-01-01T00:00:00Z") } });
	assert.deepEqual(filter({ field: "missed", op: "atLeast", value: 3 }), { ignoredIssues: { $gte: 3 } });
	assert.deepEqual(filter({ field: "received", op: "atMost", value: 2 }), { "stats.sent": { $lte: 2 } });
	assert.deepEqual(filter({ field: "field:plan", op: "is", value: "Pro" }), { "fields.plan": "Pro" });
	assert.deepEqual(filter({ field: "field:seats", op: "greaterThan", value: 10 }), { "fields.seats": { $gt: 10 } });
	assert.deepEqual(filter({ field: "field:renews", op: "inNext", value: 30 }), { "fields.renews": { $gte: "2026-10-23", $lte: "2026-11-22" } });
	assert.deepEqual(filter({ field: "field:renews", op: "inLast", value: 7 }), { "fields.renews": { $gte: "2026-10-16", $lte: "2026-10-23" } });
	assert.deepEqual(filter({ field: "firstName", op: "isSet" }), { firstName: { $exists: true, $nin: [null, ""] } });
});

test("all rules, any rule, no rules, and a rule that can't be read matches nobody rather than everybody", () => {
	const vip = { field: "tag", op: "has", value: "vip" };
	const paris = { field: "tag", op: "has", value: "paris" };
	assert.deepEqual(buildSegmentFilter({ match: "all", conditions: [vip, paris] }, { now: NOW }), { $and: [{ tags: "vip" }, { tags: "paris" }] });
	assert.deepEqual(buildSegmentFilter({ match: "any", conditions: [vip, paris] }, { now: NOW }), { $or: [{ tags: "vip" }, { tags: "paris" }] });
	assert.deepEqual(buildSegmentFilter({ match: "all", conditions: [] }), {});
	assert.deepEqual(buildSegmentFilter(null), {});
	assert.deepEqual(buildSegmentFilter({ match: "all", conditions: [{ field: "nonsense", op: "is", value: "x" }] }, { now: NOW }), { $and: [{ _id: null }] });
	assert.deepEqual(buildSegmentFilter({ match: "all", conditions: [{ field: "tag", op: "has", value: { $ne: 1 } }] }, { now: NOW }), { $and: [{ _id: null }] }, "an operator object as a value can't widen the filter");
});

test("a segment reads back as a sentence", () => {
	const segment = { match: "any", conditions: [{ field: "tag", op: "has", value: "vip" }, { field: "opened", op: "notInLast", value: 90 }, { field: "field:renews", op: "inNext", value: 1 }, { field: "clicked", op: "never" }] };
	assert.equal(describeSegmentRules(segment, fieldDefs), "Tag has vip or Last opened an email not in the last 90 days or Renewal date in the next 1 day or Last clicked a link never");
});
