import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRICE_PER_1000, estimateCost, formatCost, getPricePer1000, startOfMonth } from "../lib/send-cost.js";

test("cost is the price per thousand emails", () => {
	assert.equal(estimateCost(1000, 0.1), 0.1);
	assert.ok(Math.abs(estimateCost(4000, 0.1) - 0.4) < 1e-9);
	assert.equal(estimateCost(0), 0);
	assert.equal(estimateCost(-5), 0);
	assert.equal(estimateCost("abc"), 0);
});

test("the price comes from SES_PRICE_PER_1000 when it's a valid number", () => {
	assert.equal(getPricePer1000("0.25"), 0.25);
	assert.equal(getPricePer1000("0"), 0);
	assert.equal(getPricePer1000("abc"), DEFAULT_PRICE_PER_1000);
	assert.equal(getPricePer1000("-1"), DEFAULT_PRICE_PER_1000);
	assert.equal(getPricePer1000(undefined), DEFAULT_PRICE_PER_1000);
});

test("small amounts don't read as free", () => {
	assert.equal(formatCost(0), "$0.00");
	assert.equal(formatCost(0.0004), "< $0.01");
	assert.equal(formatCost(0.4), "$0.40");
	assert.equal(formatCost(12.345), "$12.35");
});

test("the month starts at midnight UTC on the 1st", () => {
	assert.equal(startOfMonth(new Date("2026-10-13T18:45:00.000Z")).toISOString(), "2026-10-01T00:00:00.000Z");
	assert.equal(startOfMonth(new Date("2026-12-31T23:59:59.000Z")).toISOString(), "2026-12-01T00:00:00.000Z");
});
