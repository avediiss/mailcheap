import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";
import { qstashSchedules } from "./stubs/qstash.mjs";

// Phase 2 is the schedule and the empty job, so that is what this checks: the scan reports what it would
// search, the feature flag stops it without failing the job, the route can't be called unsigned, and the
// schedule reaches QStash once with the right cadence.

let db;
let models;
let tenant;

before(async () => {
	db = await startDb();
	models = db.models;
});

after(async () => {
	await db.stop();
	delete process.env.GTM_ENABLED;
});

beforeEach(async () => {
	await db.reset();
	delete process.env.GTM_ENABLED;
	tenant = await makeTenant(models, { name: "Acme", slug: "acme" });
});

async function readyProduct({ status = "ready" } = {}) {
	return models.GtmProduct.create({
		workspaceId: tenant.workspace._id,
		url: "https://acme.test",
		onboardingStatus: status,
	});
}

describe("the scan itself", () => {
	test("with the module off it skips, and says so instead of failing", async () => {
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await readyProduct();

		const result = await runRadarScan();
		// A thrown error would make QStash retry a job that is switched off on purpose.
		assert.deepEqual(result, { skipped: "the GTM agent is off" });
	});

	test("with the module on it reports what it would search, and searches nothing yet", async () => {
		process.env.GTM_ENABLED = "true";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		const product = await readyProduct();
		await models.GtmWatchedSource.create({
			workspaceId: tenant.workspace._id,
			productId: product._id,
			platform: "x",
			url: "https://x.com/acme",
			identifier: "acme",
		});

		const result = await runRadarScan({ now: new Date("2026-11-03T09:00:00Z") });
		assert.equal(result.ran, true);
		assert.equal(result.at, "2026-11-03T09:00:00.000Z");
		assert.equal(result.products, 1);
		assert.equal(result.sources, 1);
		assert.equal(result.searched, 0, "nothing is searched until next week");
	});

	test("it counts only finished onboardings and sources still switched on", async () => {
		process.env.GTM_ENABLED = "true";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		const halfway = await readyProduct({ status: "interviewed" });
		await models.GtmWatchedSource.create({
			workspaceId: tenant.workspace._id,
			productId: halfway._id,
			platform: "reddit",
			url: "https://reddit.com/r/saas",
			identifier: "saas",
			active: false,
		});

		const result = await runRadarScan();
		assert.equal(result.products, 0, "a product mid-onboarding has no keywords to search on");
		assert.equal(result.sources, 0, "a source switched off is not scanned");
	});

	test("it runs with no products at all, which is the state right after deploying", async () => {
		process.env.GTM_ENABLED = "true";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");

		assert.deepEqual(await runRadarScan({ now: new Date("2026-11-03T12:00:00Z") }), {
			ran: true,
			at: "2026-11-03T12:00:00.000Z",
			products: 0,
			sources: 0,
			searched: 0,
		});
	});
});

describe("the job route", () => {
	test("an unsigned request is refused, so the scan isn't a public endpoint", async () => {
		const { POST } = await import("@/app/api/jobs/gtm-radar/route");
		// No signing keys are configured here, which is how a real deployment refuses a forged call.
		const response = await POST(new Request("https://namag.test/api/jobs/gtm-radar", { method: "POST" }));

		assert.equal(response.status, 503);
		assert.match((await response.json()).error, /QStash is not configured/);
	});

	test("a delivered job answers 200 with what the scan found", async () => {
		process.env.GTM_ENABLED = "true";
		process.env.NODE_ENV = "development";
		try {
			const { POST } = await import("@/app/api/jobs/gtm-radar/route");
			await readyProduct();

			const response = await POST(new Request("https://namag.test/api/jobs/gtm-radar", { method: "POST" }));
			assert.equal(response.status, 200);
			const body = await response.json();
			assert.equal(body.ran, true);
			assert.equal(body.products, 1);
		} finally {
			delete process.env.NODE_ENV;
		}
	});

	test("the module being off is still a 200, so QStash stops retrying it", async () => {
		process.env.NODE_ENV = "development";
		try {
			const { POST } = await import("@/app/api/jobs/gtm-radar/route");
			const response = await POST(new Request("https://namag.test/api/jobs/gtm-radar", { method: "POST" }));

			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), { skipped: "the GTM agent is off" });
		} finally {
			delete process.env.NODE_ENV;
		}
	});
});

describe("the schedule at QStash", () => {
	test("creating it registers one three-hourly POST to the job route", async () => {
		const { createGtmRadarSchedule } = await import("@/lib/gtm/radar-schedule");

		const { scheduleId, cron, destination } = await createGtmRadarSchedule();
		assert.equal(scheduleId, "gtm-radar-scan");
		assert.equal(cron, "0 */3 * * *");
		assert.match(destination, /\/api\/jobs\/gtm-radar$/);

		const registered = qstashSchedules().get("gtm-radar-scan");
		assert.equal(registered.method, "POST");
		assert.equal(registered.retries, 1, "the next scan is three hours away, so one retry is enough");
		assert.equal(registered.headers["Content-Type"], "application/json");
	});

	test("creating it twice leaves one schedule, not two out of phase", async () => {
		const { createGtmRadarSchedule, getGtmRadarSchedule } = await import("@/lib/gtm/radar-schedule");

		await createGtmRadarSchedule();
		await createGtmRadarSchedule();

		assert.equal(qstashSchedules().size, 1);
		assert.equal((await getGtmRadarSchedule()).scheduleId, "gtm-radar-scan");
	});

	test("it can be found and removed again", async () => {
		const { createGtmRadarSchedule, getGtmRadarSchedule, removeGtmRadarSchedule } = await import("@/lib/gtm/radar-schedule");

		assert.equal(await getGtmRadarSchedule(), null, "nothing is scheduled until it is created");
		await createGtmRadarSchedule();
		assert.ok(await getGtmRadarSchedule());

		await removeGtmRadarSchedule();
		assert.equal(await getGtmRadarSchedule(), null);
	});

	test("the schedule is independent of the flag: it can be in place while the module is off", async () => {
		const { createGtmRadarSchedule, getGtmRadarSchedule } = await import("@/lib/gtm/radar-schedule");
		await createGtmRadarSchedule();

		assert.equal(process.env.GTM_ENABLED, undefined);
		assert.ok(await getGtmRadarSchedule(), "switching the module on later needs no new schedule");
	});
});
