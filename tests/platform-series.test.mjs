import assert from "node:assert/strict";
import { test } from "node:test";
import {
	OTHERS_ID,
	buildSendSeries,
	findQuietWorkspaces,
	formatIdle,
	getProjectionState,
	parseRange,
	projectMonthEnd,
	rangeDayKeys,
	rate,
	rollingRate,
	stackSeries,
} from "../lib/platform-series.js";

const keys = rangeDayKeys("2026-10-22", 4);

test("a range is 7, 30 or 90 days and anything else is 30", () => {
	assert.equal(parseRange("7"), 7);
	assert.equal(parseRange("90"), 90);
	assert.equal(parseRange("45"), 30);
	assert.equal(parseRange(undefined), 30);
	assert.equal(parseRange("30; drop"), 30);
	assert.deepEqual(keys, ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
	assert.equal(rangeDayKeys("2026-03-01", 2)[0], "2026-02-28");
});

test("sends are summed per day and per workspace, and rows outside the range are ignored", () => {
	const { days, totals, perWorkspace } = buildSendSeries({
		dayKeys: keys,
		rows: [
			{ day: "2026-10-20", workspaceId: "a", sent: 10, bounced: 1, opened: 4 },
			{ day: "2026-10-20", workspaceId: "b", sent: 5, complained: 1 },
			{ day: "2026-10-22", workspaceId: "a", sent: 3 },
			{ day: "2026-09-01", workspaceId: "a", sent: 999 },
		],
	});
	assert.deepEqual(days.map(({ sent }) => sent), [0, 15, 0, 3]);
	assert.deepEqual(days[1].byWorkspace, { a: 10, b: 5 });
	assert.equal(totals.sent, 18);
	assert.equal(totals.bounced, 1);
	assert.equal(totals.complained, 1);
	assert.equal(totals.opened, 4);
	assert.deepEqual(perWorkspace.a.daily, [0, 10, 0, 3]);
	assert.equal(perWorkspace.b.sent, 5);
	assert.equal(perWorkspace.c, undefined);
});

test("a stacked chart names the biggest workspaces and folds the rest into Others, keeping each day's total", () => {
	const rows = ["a", "b", "c", "d"].flatMap((id, position) => [{ day: "2026-10-22", workspaceId: id, sent: (4 - position) * 10 }]);
	const { days, perWorkspace } = buildSendSeries({ dayKeys: keys, rows });
	const names = new Map([["a", "Acme"], ["b", "Birch"], ["c", "Cedar"], ["d", "Dune"]]);

	const stacked = stackSeries({ days, perWorkspace, names, top: 2 });
	assert.deepEqual(stacked.series.map(({ id }) => id), ["a", "b", OTHERS_ID]);
	assert.deepEqual(stacked.days.at(-1).parts, [40, 30, 30]);
	assert.equal(stacked.days.at(-1).total, 100);
	assert.deepEqual(stacked.days[0].parts, [0, 0, 0]);

	const all = stackSeries({ days, perWorkspace, names, top: 5 });
	assert.deepEqual(all.series.map(({ id }) => id), ["a", "b", "c", "d"], "no Others when everyone fits");
	assert.equal(stackSeries({ days, perWorkspace: {}, names, top: 5 }).series.length, 0);
});

test("a rolling rate uses the trailing window and says nothing until there are enough sends", () => {
	const days = [
		{ sent: 10, bounced: 0 },
		{ sent: 10, bounced: 1 },
		{ sent: 0, bounced: 0 },
		{ sent: 20, bounced: 2 },
	];
	assert.deepEqual(rollingRate(days, "bounced", { window: 7, minSent: 20 }), [null, 1 / 20, 1 / 20, 3 / 40]);
	assert.deepEqual(rollingRate(days, "bounced", { window: 2, minSent: 20 }), [null, 1 / 20, null, 2 / 20]);
	assert.equal(rate(1, 0), null);
	assert.equal(rate(1, 4), 0.25);
});

test("the month's pace: projected from the days gone, and only trusted after a few of them", () => {
	const tenth = new Date(Date.UTC(2026, 9, 11)); // 10 days into a 31-day month
	assert.deepEqual(
		{ ...projectMonthEnd({ used: 100, now: tenth }), elapsedDays: undefined },
		{ projected: 310, elapsedDays: undefined, daysInMonth: 31, isReliable: true }
	);
	assert.equal(projectMonthEnd({ used: 5, now: new Date(Date.UTC(2026, 9, 1, 12)) }).isReliable, false, "half a day isn't a pace");
	assert.equal(projectMonthEnd({ used: 0, now: tenth }).isReliable, false, "nothing sent says nothing");
	assert.equal(projectMonthEnd({ used: 0, now: tenth }).projected, 0);

	assert.equal(getProjectionState({ used: 100, limit: 200, now: tenth }).state, "over");
	assert.equal(getProjectionState({ used: 100, limit: 400, now: tenth }).state, "ok");
	assert.equal(getProjectionState({ used: 200, limit: 200, now: tenth }).state, "reached");
	assert.equal(getProjectionState({ used: 100, limit: null, now: tenth }).state, "none");
	assert.equal(getProjectionState({ used: 5, limit: 6, now: new Date(Date.UTC(2026, 9, 1, 12)) }).state, "ok", "too early to warn");
});

test("quiet workspaces: active ones that stopped sending, or never started after their first week", () => {
	const now = new Date("2026-10-22T12:00:00Z");
	const ago = (days) => new Date(now.getTime() - days * 86_400_000);
	const workspaces = [
		{ id: "a", name: "Active", status: "active", createdAt: ago(100) },
		{ id: "b", name: "Stopped", status: "active", createdAt: ago(100) },
		{ id: "c", name: "Never", status: "active", createdAt: ago(40) },
		{ id: "d", name: "New", status: "active", createdAt: ago(2) },
		{ id: "e", name: "Suspended", status: "suspended", createdAt: ago(100) },
		{ id: "f", name: "Edge", status: "active", createdAt: ago(100) },
	];
	const lastSentBy = new Map([["a", ago(2)], ["b", ago(45)], ["e", ago(90)], ["f", ago(30)]]);
	const quiet = findQuietWorkspaces({ workspaces, lastSentBy, now });
	assert.deepEqual(quiet.map(({ id }) => id), ["c", "b", "f"], "never-sent first, then longest idle");
	assert.equal(quiet[1].idleDays, 45);
	assert.equal(formatIdle(quiet[0].idleDays), "Never sent");
	assert.equal(formatIdle(45), "No send in 45 days");
});
