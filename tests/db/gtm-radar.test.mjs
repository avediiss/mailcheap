import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";
import { queueAiAnswers } from "./stubs/anthropic.mjs";
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
		// An X source: stored at onboarding, but no reader exists for that platform yet.
		assert.deepEqual(result.results[0].problems, []);
		assert.equal(result.created, 0);
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
		assert.equal(result.products, 0, "a product mid-onboarding is not scanned at all");
		assert.equal(result.created, 0);
	});

	test("it runs with no products at all, which is the state right after deploying", async () => {
		process.env.GTM_ENABLED = "true";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");

		assert.deepEqual(await runRadarScan({ now: new Date("2026-11-03T12:00:00Z") }), {
			ran: true,
			at: "2026-11-03T12:00:00.000Z",
			products: 0,
			created: 0,
			scored: 0,
			results: [],
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

describe("the scan that actually scans", () => {
	const KEYWORDS = ["ga4", "cookieless analytics"];

	function hnHits(hits) {
		return { hits, nbPages: 1 };
	}

	function hit(id, overrides = {}) {
		return {
			objectID: id,
			author: "someone",
			comment_text: "GA4 is confusing and I cannot find basic traffic numbers without building a report.",
			created_at_i: Math.floor(new Date("2026-11-03T08:00:00Z").getTime() / 1000),
			story_title: "Ask HN: what analytics do you use?",
			story_url: "https://example.com/thread",
			...overrides,
		};
	}

	// Every Hacker News request in a scan answers the same way; what matters here is what the scan does
	// with the answers, not which keyword produced them.
	async function withHn(hits, run) {
		const original = globalThis.fetch;
		globalThis.fetch = async () => new Response(JSON.stringify(hnHits(hits)), { headers: { "content-type": "application/json" } });
		try {
			return await run();
		} finally {
			globalThis.fetch = original;
		}
	}

	async function scannableProduct() {
		const product = await models.GtmProduct.create({
			workspaceId: tenant.workspace._id,
			url: "https://acme.test",
			onboardingStatus: "ready",
			oneLinePitch: "Cookie-free analytics.",
			targetCustomer: "Site owners tired of GA4.",
			pains: ["GA4 is confusing."],
			keywords: KEYWORDS,
		});
		await models.GtmWatchedSource.create({
			workspaceId: tenant.workspace._id,
			productId: product._id,
			platform: "hn",
			url: "https://news.ycombinator.com",
			identifier: "news.ycombinator.com",
		});
		return product;
	}

	test("it finds posts, stores them, scores them and moves the watermark", async () => {
		process.env.GTM_ENABLED = "true";
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		const product = await scannableProduct();
		queueAiAnswers({ json: { scores: [{ external_id: "p1", score: 88, reason: "Asking what to use after GA4." }] } });

		const now = new Date("2026-11-03T09:00:00Z");
		const result = await withHn([hit("p1")], () => runRadarScan({ now }));

		assert.equal(result.created, 1);
		assert.equal(result.scored, 1);
		const [row] = await models.GtmOpportunity.find({}).lean();
		assert.equal(row.externalId, "p1");
		assert.equal(row.score, 88);
		assert.match(row.reason, /after GA4/);
		assert.equal(row.status, "new");
		// The window has been read, so the next scan starts here.
		const source = await models.GtmWatchedSource.findOne({ productId: product._id }).lean();
		assert.equal(source.lastScanAt.toISOString(), now.toISOString());
		assert.equal(source.lastError, null);
	});

	test("a second scan finds the same post and stores nothing new", async () => {
		process.env.GTM_ENABLED = "true";
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await scannableProduct();
		queueAiAnswers({ json: { scores: [{ external_id: "p1", score: 70, reason: "Worth a reply." }] } });
		await withHn([hit("p1")], () => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") }));

		// No AI answer queued: already-stored posts must not reach the scorer at all.
		const second = await withHn([hit("p1")], () => runRadarScan({ now: new Date("2026-11-03T12:00:00Z") }));

		assert.equal(second.created, 0);
		assert.equal(second.scored, 0);
		assert.equal(await models.GtmOpportunity.countDocuments({}), 1);
	});

	test("a platform that is down costs the window, not the watermark or the scan", async () => {
		process.env.GTM_ENABLED = "true";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		const product = await scannableProduct();

		const original = globalThis.fetch;
		globalThis.fetch = async () => new Response("nope", { status: 503 });
		let result;
		try {
			result = await runRadarScan({ now: new Date("2026-11-03T09:00:00Z") });
		} finally {
			globalThis.fetch = original;
		}

		// The job itself succeeded, so QStash must not retry it.
		assert.equal(result.ran, true);
		assert.match(result.results[0].problems[0].error, /503/);
		const source = await models.GtmWatchedSource.findOne({ productId: product._id }).lean();
		assert.equal(source.lastScanAt, null, "the failed window is covered again next time");
		assert.match(source.lastError, /503/);
	});

	test("without an AI key posts are still found and stored, just unscored", async () => {
		process.env.GTM_ENABLED = "true";
		delete process.env.ANTHROPIC_API_KEY;
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await scannableProduct();

		const result = await withHn([hit("p1")], () => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") }));

		assert.equal(result.created, 1);
		assert.equal(result.scored, 0);
		const [row] = await models.GtmOpportunity.find({}).lean();
		assert.equal(row.score, undefined);
	});

	test("posts beyond the scoring budget are saved, and scored by the next scan", async () => {
		// The bug this pins: the cap used to decide what was saved, and the watermark moved past whatever it
		// cut, so those posts were never seen again. Now the cap limits spending, not storage.
		process.env.GTM_ENABLED = "true";
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await scannableProduct();

		// More posts than the old cap of 50, or the old code passes this test too and it pins nothing. Each
		// keyword and kind answers with its own 25, so a hundred distinct posts reach the job.
		const base = Math.floor(new Date("2026-11-03T00:00:00Z").getTime() / 1000);
		let request = 0;
		const original = globalThis.fetch;
		globalThis.fetch = async () => {
			const offset = request * 25;
			request += 1;
			const hits = Array.from({ length: 25 }, (_, index) => hit(`r${request}-${index}`, { created_at_i: base + (offset + index) * 60 }));
			return new Response(JSON.stringify(hnHits(hits)), { headers: { "content-type": "application/json" } });
		};
		// The scorer is answered for every id; it keeps only the ones actually in its batch.
		const everyId = Array.from({ length: 4 }, (_, r) => Array.from({ length: 25 }, (_, index) => `r${r + 1}-${index}`)).flat();
		const answer = () => ({ json: { scores: everyId.map((id) => ({ external_id: id, score: 50, reason: "Judged." })) } });

		let first;
		let second;
		try {
			queueAiAnswers(answer());
			first = await runRadarScan({ now: new Date("2026-11-03T09:00:00Z"), scoreLimit: 2 });
			// Nothing new arrives — the same posts come back, already known — but the backlog waits.
			request = 0;
			queueAiAnswers(answer());
			second = await runRadarScan({ now: new Date("2026-11-03T12:00:00Z"), scoreLimit: 2 });
		} finally {
			globalThis.fetch = original;
		}

		assert.equal(first.created, 100, "everything the rules pass is saved, whatever the budget");
		assert.equal(first.scored, 2);
		assert.equal(second.created, 0);
		assert.equal(second.scored, 2, "the next scan works through the backlog");
		assert.equal(await models.GtmOpportunity.countDocuments({ score: { $ne: null } }), 4);
		assert.equal(await models.GtmOpportunity.countDocuments({ score: null }), 96);
	});

	test("a hiring thread never reaches the scorer", async () => {
		process.env.GTM_ENABLED = "true";
		process.env.ANTHROPIC_API_KEY = "sk-ant-test";
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await scannableProduct();
		// No AI answer queued: if anything reached the scorer this test would fail.
		const hits = [hit("p1", { story_title: "Ask HN: Who wants to be hired? (November 2026)" })];

		const result = await withHn(hits, () => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") }));

		assert.equal(result.created, 0);
		assert.equal(result.scored, 0);
		assert.equal(await models.GtmOpportunity.countDocuments({}), 0);
	});
});

describe("Bluesky in the scan", () => {
	function blueskyPost(id, overrides = {}) {
		return {
			uri: `at://did:plc:test/app.bsky.feed.post/${id}`,
			author: { handle: "someone.bsky.social" },
			record: { text: "Anyone know a ga4 replacement that isn't a nightmare?", createdAt: "2026-11-03T08:00:00.000Z" },
			indexedAt: "2026-11-03T08:00:01.000Z",
			...overrides,
		};
	}

	async function blueskyProduct({ withProfile = false } = {}) {
		const product = await models.GtmProduct.create({
			workspaceId: tenant.workspace._id,
			url: "https://acme.test",
			onboardingStatus: "ready",
			keywords: ["ga4", "cookie banner"],
		});
		const base = { workspaceId: tenant.workspace._id, productId: product._id, platform: "bluesky" };
		await models.GtmWatchedSource.create({ ...base, url: "https://bsky.app", identifier: "bsky.app" });
		if (withProfile) {
			await models.GtmWatchedSource.create({
				...base,
				url: "https://bsky.app/profile/founder.bsky.social",
				identifier: "profile/founder.bsky.social",
			});
		}
		return product;
	}

	// Answers by the query each request asks, and records which hosts were asked.
	async function withBluesky(answer, run) {
		const original = globalThis.fetch;
		const hosts = [];
		globalThis.fetch = async (url) => {
			const parsed = new URL(url);
			hosts.push(parsed.host);
			const { status = 200, posts = [] } = answer(parsed.searchParams.get("q")) ?? {};
			return new Response(JSON.stringify({ posts }), { status, headers: { "content-type": "application/json" } });
		};
		try {
			return { result: await run(), hosts };
		} finally {
			globalThis.fetch = original;
		}
	}

	test("a Bluesky source is searched and its posts reach the queue as Bluesky posts", async () => {
		process.env.GTM_ENABLED = "true";
		delete process.env.ANTHROPIC_API_KEY;
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await blueskyProduct();

		const { result, hosts } = await withBluesky(
			(query) => ({ posts: query === "ga4" ? [blueskyPost("a")] : [] }),
			() => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") })
		);

		assert.equal(result.created, 1);
		assert.ok(hosts.every((host) => host === "api.bsky.app"));
		const [row] = await models.GtmOpportunity.find({}).lean();
		assert.equal(row.platform, "bluesky");
		assert.equal(row.url, "https://bsky.app/profile/someone.bsky.social/post/a");
	});

	test("a profile source is never searched, and the founder's own posts never reach the queue", async () => {
		process.env.GTM_ENABLED = "true";
		delete process.env.ANTHROPIC_API_KEY;
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		await blueskyProduct({ withProfile: true });
		const own = blueskyPost("own", { author: { handle: "Founder.bsky.social" } });

		const { result, hosts } = await withBluesky(
			(query) => ({ posts: query === "ga4" ? [own, blueskyPost("theirs")] : [] }),
			() => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") })
		);

		// Two keywords against one searchable source: two requests, not four.
		assert.equal(hosts.length, 2);
		assert.equal(result.created, 1);
		assert.deepEqual(
			(await models.GtmOpportunity.find({}).lean()).map((row) => row.author),
			["someone.bsky.social"]
		);
	});

	test("one keyword failing keeps what the others found, and leaves the watermark for another try", async () => {
		process.env.GTM_ENABLED = "true";
		delete process.env.ANTHROPIC_API_KEY;
		const { runRadarScan } = await import("@/lib/gtm/radar-jobs");
		const product = await blueskyProduct();
		const cookiePost = blueskyPost("c", { record: { text: "this cookie banner is ruining my site", createdAt: "2026-11-03T08:00:00.000Z" } });

		const { result } = await withBluesky(
			(query) => (query === "ga4" ? { status: 500 } : { posts: [cookiePost] }),
			() => runRadarScan({ now: new Date("2026-11-03T09:00:00Z") })
		);

		// Before, the error threw this post away; a keyword that always failed would have starved the platform.
		assert.equal(result.created, 1);
		assert.match(result.results[0].problems[0].error, /500/);
		const source = await models.GtmWatchedSource.findOne({ productId: product._id }).lean();
		assert.equal(source.lastScanAt, null, "the window is read again next time");
	});
});
