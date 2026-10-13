import assert from "node:assert/strict";
import { test } from "node:test";
import {
	MAX_DELAY_DAYS,
	MAX_STEPS,
	MAX_WAIT_MS,
	getJobWake,
	getNextStepIndex,
	getSequenceContent,
	getSequenceProblem,
	getSequenceSteps,
	getStepDueAt,
	normalizeSteps,
} from "../lib/sequence.js";

const DAY = 24 * 60 * 60 * 1000;
const step = (delayDays, subject = `Day ${delayDays}`, markdown = "Hello") => ({ delayDays, subject, previewText: "", markdown });

test("steps are cleaned: incomplete rows dropped, sorted by day, delays kept in range, capped", () => {
	const steps = normalizeSteps([step(5), { delayDays: 2, subject: "", markdown: "" }, step(2), step(500, "Late"), step(0, "Soon")]);
	assert.deepEqual(steps.map(({ delayDays }) => delayDays), [1, 2, 5, MAX_DELAY_DAYS]);
	assert.equal(normalizeSteps(undefined).length, 0);
	assert.equal(normalizeSteps(Array.from({ length: 9 }, (_, index) => step(index + 1))).length, MAX_STEPS);
	assert.equal(normalizeSteps([{ delayDays: "x", subject: "A", markdown: "B" }])[0].delayDays, 1, "a bad number means day 1");
});

test("the settings form is checked before saving", () => {
	assert.equal(getSequenceProblem([]), null);
	assert.equal(getSequenceProblem([step(2), { delayDays: "3", subject: "", markdown: "" }]), null, "a blank row is ignored");
	assert.match(getSequenceProblem([{ delayDays: "2", subject: "Hi", markdown: "" }]), /Email 1 .*subject and content/);
	assert.match(getSequenceProblem([{ delayDays: "0", subject: "Hi", markdown: "x" }]), /1 to 90 days/);
	assert.match(getSequenceProblem([{ delayDays: "2.5", subject: "Hi", markdown: "x" }]), /1 to 90 days/);
	assert.match(getSequenceProblem(Array.from({ length: MAX_STEPS + 1 }, (_, index) => step(index + 1))), /at most/);
});

test("a series that is off has no steps and no content", () => {
	const newsletter = { sequence: { enabled: false, steps: [step(2)] } };
	assert.deepEqual(getSequenceSteps(newsletter), []);
	assert.equal(getSequenceContent(newsletter, 0), null);
	assert.equal(getSequenceContent({}, 0), null);
	const on = { sequence: { enabled: true, steps: [step(4, "Second"), step(1, "First")] } };
	assert.equal(getSequenceContent(on, 0).subject, "First");
	assert.equal(getSequenceContent(on, 1).subject, "Second");
	assert.equal(getSequenceContent(on, 2), null);
	assert.equal(getSequenceContent(on, 0).format, "markdown");
});

test("steps are due a number of days after the person confirmed, or else signed up", () => {
	const subscribedAt = new Date("2026-03-01T10:00:00.000Z");
	const confirmedAt = new Date("2026-03-02T10:00:00.000Z");
	assert.equal(getStepDueAt({ contact: { subscribedAt }, delayDays: 3 }).toISOString(), "2026-03-04T10:00:00.000Z");
	assert.equal(getStepDueAt({ contact: { subscribedAt, confirmedAt }, delayDays: 3 }).toISOString(), "2026-03-05T10:00:00.000Z");
	const now = Date.parse("2026-05-01T00:00:00.000Z");
	assert.equal(getStepDueAt({ contact: {}, delayDays: 1, now }).getTime(), now + DAY);
});

test("a job waits at most six days at a time", () => {
	const now = Date.parse("2026-05-01T00:00:00.000Z");
	assert.equal(getJobWake({ dueAt: new Date(now + 2 * DAY), now }).getTime(), now + 2 * DAY);
	assert.equal(getJobWake({ dueAt: new Date(now + 30 * DAY), now }).getTime(), now + MAX_WAIT_MS);
	assert.equal(getJobWake({ dueAt: new Date(now - DAY), now }).getTime(), now - DAY, "overdue means now");
});

test("the next step follows until the last one", () => {
	const steps = [step(1), step(2), step(3)];
	assert.equal(getNextStepIndex(steps, 0), 1);
	assert.equal(getNextStepIndex(steps, 1), 2);
	assert.equal(getNextStepIndex(steps, 2), null);
});
