import assert from "node:assert/strict";
import { test } from "node:test";
import { getAccountBlockReason, getHealthWindowStart } from "../lib/workspace-health.js";

test("a workspace is blocked past 5% hard bounces or 0.3% complaints, once enough have happened to mean it", () => {
	assert.equal(getAccountBlockReason(), null);
	assert.equal(getAccountBlockReason({ sent: 0, bounced: 0 }), null);
	assert.equal(getAccountBlockReason({ sent: 1000, bounced: 50 }), null, "exactly 5% is not over");
	assert.equal(getAccountBlockReason({ sent: 100, bounced: 9 }), null, "over 5%, but fewer than 10 bounces");
	assert.match(getAccountBlockReason({ sent: 100, bounced: 10 }), /10\.0% of the last 7 days' emails bounced/);
	assert.match(getAccountBlockReason({ sent: 1000, bounced: 51 }), /5\.1%/);
	assert.equal(getAccountBlockReason({ sent: 10000, bounced: 400, complained: 2 }), null, "4% bounces, two complaints: fine");
	assert.equal(getAccountBlockReason({ sent: 1000, complained: 2 }), null, "two complaints is below the minimum of 3");
	assert.match(getAccountBlockReason({ sent: 1000, complained: 3 }), /0\.30% of the last 7 days' emails were marked as spam/);
	assert.equal(getAccountBlockReason({ sent: 10000, complained: 29 }), null, "0.29% is under");
	assert.match(getAccountBlockReason({ sent: 10000, complained: 30 }), /spam/);
});

test("the numbers are counted over seven days, or since the platform last cleared the block, whichever is shorter", () => {
	const now = new Date("2026-10-23T12:00:00Z");
	assert.equal(getHealthWindowStart({ now }).toISOString(), "2026-10-16T12:00:00.000Z");
	assert.equal(getHealthWindowStart({ now, healthResetAt: new Date("2026-10-01T00:00:00Z") }).toISOString(), "2026-10-16T12:00:00.000Z", "an old reset changes nothing");
	assert.equal(getHealthWindowStart({ now, healthResetAt: new Date("2026-10-22T08:00:00Z") }).toISOString(), "2026-10-22T08:00:00.000Z", "a recent reset starts a fresh count");
});
