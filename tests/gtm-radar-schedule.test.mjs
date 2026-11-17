import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_URL = "https://namag.test";

const { GTM_RADAR_JOB_PATH, GTM_RADAR_SCHEDULE_ID, getGtmRadarCron, getGtmRadarUrl, getScheduleProblem } = await import(
	"../lib/gtm/radar-schedule.js"
);

test("the scan is scheduled every three hours, on the hour", () => {
	assert.equal(getGtmRadarCron(), "0 */3 * * *");
});

test("the schedule has a fixed id, so creating it twice can't leave two of them", () => {
	assert.equal(GTM_RADAR_SCHEDULE_ID, "gtm-radar-scan");
});

test("it posts to the job route on this deployment's own URL", () => {
	assert.equal(GTM_RADAR_JOB_PATH, "/api/jobs/gtm-radar");
	assert.equal(getGtmRadarUrl(), "https://namag.test/api/jobs/gtm-radar");
});

test("a local URL is refused rather than scheduled and silently never delivered", () => {
	// QStash accepts any URL it is given and then fails every three hours against one it can't reach.
	for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]) {
		const problem = getScheduleProblem(`http://${host}:3000/api/jobs/gtm-radar`);
		assert.match(problem ?? "", /QStash can't reach/, `${host} is refused`);
	}
});

test("a public URL is accepted, over either protocol", () => {
	assert.equal(getScheduleProblem("https://namag.test/api/jobs/gtm-radar"), null);
	assert.equal(getScheduleProblem("http://namag.test/api/jobs/gtm-radar"), null);
});

test("something that isn't an HTTP URL is refused", () => {
	assert.match(getScheduleProblem("ftp://namag.test/api/jobs/gtm-radar") ?? "", /not an HTTP URL/);
});
