import assert from "node:assert/strict";
import { test } from "node:test";
import {
	arrangeWaves,
	describeSendPlan,
	getDailySendCap,
	getDayDelaySeconds,
	getDayIndex,
	getMaxRecipients,
	getRemainingToday,
	getSliceSize,
	getWarmupDay,
	scheduleBatches,
	secondsUntilNextUtcDay,
} from "../lib/send-plan.js";

const DAY = 86_400_000;
const NOW = new Date("2026-10-23T12:00:00Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY);

test("a new sender starts at 200 a day and doubles every three days for the first month", () => {
	const cap = (days, extra = {}) => getDailySendCap({ firstSentAt: daysAgo(days), now: NOW, ...extra });
	assert.equal(getDailySendCap({ now: NOW }), 200, "never sent: day one");
	assert.deepEqual([0, 2, 3, 5, 6, 9, 12, 15, 18, 21, 24, 27, 29].map((days) => cap(days)), [200, 200, 400, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400, 102400]);
	assert.equal(getWarmupDay({ now: NOW }), 1);
	assert.equal(getWarmupDay({ firstSentAt: daysAgo(4), now: NOW }), 5);
});

test("after the first month the allowance is five times the busiest recent day, never under 2,000", () => {
	const cap = (largestRecentDay) => getDailySendCap({ firstSentAt: daysAgo(40), now: NOW, largestRecentDay });
	assert.equal(cap(0), 2000);
	assert.equal(cap(300), 2000);
	assert.equal(cap(1000), 5000);
	assert.equal(cap(20000), 100000);
});

test("trusted workspaces have no limit, an override replaces the schedule, and borderline numbers stop the growth", () => {
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(1), now: NOW, isTrusted: true }), Number.POSITIVE_INFINITY);
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(1), now: NOW, capOverride: 750 }), 750);
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(1), now: NOW, capOverride: 0 }), 200, "zero isn't an override");
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(15), now: NOW, largestRecentDay: 900, isWatch: true }), 900, "no growth past what it has done");
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(15), now: NOW, largestRecentDay: 50, isWatch: true }), 200);
	assert.equal(getDailySendCap({ firstSentAt: daysAgo(15), now: NOW, largestRecentDay: 900, isWatch: false }), 6400);
});

test("a send reaches what is left today plus two more full days, and each email knows which day it goes", () => {
	assert.equal(getRemainingToday({ cap: 200, sentToday: 50 }), 150);
	assert.equal(getRemainingToday({ cap: 200, sentToday: 500 }), 0);
	assert.equal(getMaxRecipients({ cap: 200, sentToday: 50 }), 150 + 400);
	assert.equal(getMaxRecipients({ cap: Number.POSITIVE_INFINITY, sentToday: 5 }), Number.POSITIVE_INFINITY);
	const day = (position) => getDayIndex({ position, cap: 200, sentToday: 50 });
	assert.deepEqual([0, 149, 150, 349, 350, 549, 550].map(day), [0, 0, 1, 1, 2, 2, 3]);
	assert.equal(getDayIndex({ position: 99999, cap: Number.POSITIVE_INFINITY, sentToday: 0 }), 0);
});

test("later days wait until just after midnight UTC", () => {
	const noon = new Date("2026-10-23T12:00:00Z");
	assert.equal(secondsUntilNextUtcDay(noon), 12 * 3600 + 300);
	assert.equal(getDayDelaySeconds({ dayIndex: 0, now: noon }), 0);
	assert.equal(getDayDelaySeconds({ dayIndex: 1, now: noon }), 12 * 3600 + 300);
	assert.equal(getDayDelaySeconds({ dayIndex: 2, now: noon }), 12 * 3600 + 300 + 86400);
	assert.equal(secondsUntilNextUtcDay(new Date("2026-10-23T23:59:59Z")), 1 + 300);
});

test("only a send to many new people is sliced: 5% of them, between 200 and 2,000", () => {
	assert.deepEqual([0, 200, 201, 1000, 4000, 40000, 100000].map(getSliceSize), [0, 0, 200, 200, 200, 2000, 2000]);
	assert.equal(getSliceSize(10), 0);
});

test("the order of a send: known people, then the new slice, then last-chance emails, the rest of the new people held back", () => {
	const messages = [
		...Array.from({ length: 3 }, (_, index) => ({ id: `known${index}`, kind: "campaign", isNew: false })),
		...Array.from({ length: 300 }, (_, index) => ({ id: `new${index}`, kind: "campaign", isNew: true })),
		{ id: "chance0", kind: "last-chance", isNew: false },
	];
	const { first, second, slice } = arrangeWaves(messages);
	assert.deepEqual(slice, { size: 200, of: 300 });
	assert.equal(first.length, 3 + 200 + 1);
	assert.deepEqual(first.slice(0, 3).map(({ id }) => id), ["known0", "known1", "known2"]);
	assert.equal(first.at(-1).id, "chance0");
	assert.equal(second.length, 100);
	assert.equal(second[0].id, "new200");

	const small = arrangeWaves(messages.filter(({ id }) => !id.startsWith("new") || Number(id.slice(3)) < 50));
	assert.equal(small.slice, null, "50 new people go with everyone else");
	assert.equal(small.second.length, 0);
});

test("batches carry the delay they need: the held-back wave waits 3 hours, later days wait for midnight", () => {
	const make = (count, prefix) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));
	const requests = scheduleBatches({ first: make(120, "a"), second: make(60, "b"), size: 50, cap: 100, sentToday: 0, now: NOW });
	assert.deepEqual(requests.map(({ ids }) => ids.length), [50, 50, 20, 50, 10]);
	const midnight = 12 * 3600 + 300;
	// Positions 0-49 and 50-99 are today; 100-119 is tomorrow; the second wave starts at position 120 (tomorrow) and 170 (tomorrow).
	assert.deepEqual(requests.map(({ delay }) => delay), [0, 0, midnight, Math.max(3 * 3600, midnight), Math.max(3 * 3600, midnight)]);

	const open = scheduleBatches({ first: make(10, "a"), second: [], size: 50, cap: Number.POSITIVE_INFINITY, sentToday: 0, now: NOW });
	assert.deepEqual(open, [{ ids: make(10, "a").map(({ id }) => id), delay: 0 }]);
});

test("the person is told when a send is spread over days or sliced, and nothing when it just goes", () => {
	assert.deepEqual(describeSendPlan({ total: 150, cap: 200, sentToday: 0, slice: null }), []);
	assert.deepEqual(describeSendPlan({ total: 500, cap: Number.POSITIVE_INFINITY, sentToday: 0, slice: null }), []);
	const spread = describeSendPlan({ total: 500, cap: 200, sentToday: 0, slice: null });
	assert.equal(spread.length, 1);
	assert.match(spread[0], /200 emails a day.*over 3 days: 200 today/);
	const sliced = describeSendPlan({ total: 1000, cap: Number.POSITIVE_INFINITY, sentToday: 0, slice: { size: 200, of: 1000 } });
	assert.match(sliced[0], /1,000 of these people have never had an email from you\. The first 200 go out now; the rest follow 3 hours later/);
});
