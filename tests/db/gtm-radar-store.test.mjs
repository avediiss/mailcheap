import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";

// What the radar remembers. Two things have to hold however often the scan runs: a post is only ever
// stored once, and what the founder did with it is never undone by a later scan.

let db;
let models;
let tenant;
let product;

before(async () => {
	db = await startDb();
	models = db.models;
});

after(async () => {
	await db.stop();
});

beforeEach(async () => {
	await db.reset();
	tenant = await makeTenant(models, { name: "Acme", slug: "acme" });
	product = await models.GtmProduct.create({
		workspaceId: tenant.workspace._id,
		url: "https://acme.test",
		onboardingStatus: "ready",
	});
});

function candidate(overrides = {}) {
	return {
		platform: "hn",
		externalId: "50342098",
		url: "https://news.ycombinator.com/item?id=50342098",
		author: "someone",
		text: "GA4 is confusing and I cannot find basic numbers.",
		postedAt: new Date("2026-11-02T19:17:36.000Z"),
		keywords: ["ga4"],
		storyTitle: "Ask HN: what analytics do you use?",
		storyUrl: "https://example.com/thread",
		...overrides,
	};
}

async function save(candidates) {
	const { saveCandidates } = await import("@/lib/gtm/radar-store");
	return saveCandidates({ workspaceId: tenant.workspace._id, productId: product._id, candidates });
}

describe("where the next scan starts", () => {
	test("a source that has been read resumes from its watermark", async () => {
		const { scanWindowStart } = await import("@/lib/gtm/radar-store");
		const lastScanAt = new Date("2026-11-08T06:00:00.000Z");

		assert.equal(scanWindowStart({ lastScanAt }).getTime(), lastScanAt.getTime());
	});

	test("a source never read looks back a bounded window, not at the whole archive", async () => {
		const { scanWindowStart } = await import("@/lib/gtm/radar-store");
		const now = new Date("2026-11-08T12:00:00.000Z");

		const start = scanWindowStart({ lastScanAt: null, now, firstRunHours: 24 });
		assert.equal(start.toISOString(), "2026-11-07T12:00:00.000Z");
		// The point of the bound: never the epoch, however long the platform has existed.
		assert.ok(start.getTime() > new Date("2000-01-01").getTime());
	});
});

describe("saving what a scan found", () => {
	test("a new post is stored once, with its keywords and its context", async () => {
		const result = await save([candidate()]);
		assert.deepEqual(result, { created: 1, updated: 0, total: 1 });

		const rows = await models.GtmOpportunity.find({}).lean();
		assert.equal(rows.length, 1);
		assert.equal(rows[0].externalId, "50342098");
		assert.equal(rows[0].platform, "hn");
		assert.deepEqual(rows[0].keywords, ["ga4"]);
		// The platform's own words for these fields do not reach the database.
		assert.equal(rows[0].contextTitle, "Ask HN: what analytics do you use?");
		assert.equal(rows[0].contextUrl, "https://example.com/thread");
		assert.equal(rows[0].status, "new");
		assert.equal(rows[0].workspaceId.toString(), tenant.workspace._id.toString());
	});

	test("the same post found again updates the one row instead of duplicating it", async () => {
		await save([candidate()]);
		const second = await save([candidate({ text: "GA4 is confusing. Edited to add: I moved to Plausible." })]);

		assert.equal(second.created, 0);
		assert.equal(second.updated, 1);
		const rows = await models.GtmOpportunity.find({}).lean();
		assert.equal(rows.length, 1);
		assert.match(rows[0].text, /moved to Plausible/);
	});

	test("a later scan never undoes what the founder decided", async () => {
		await save([candidate()]);
		// The founder has looked at it, it has been scored, and they said no.
		await models.GtmOpportunity.updateOne(
			{ externalId: "50342098" },
			{ $set: { status: "skipped", score: 71, reason: "asking about pricing, not analytics" } }
		);

		await save([candidate({ text: "the same post, scanned again three hours later" })]);

		const row = await models.GtmOpportunity.findOne({ externalId: "50342098" }).lean();
		// Offering a skipped post again every three hours would make the queue unusable.
		assert.equal(row.status, "skipped");
		assert.equal(row.score, 71);
		assert.equal(row.reason, "asking about pricing, not analytics");
		assert.match(row.text, /scanned again/);
	});

	test("two products can both hold the same post", async () => {
		const otherTenant = await makeTenant(models, { name: "Birch", slug: "birch" });
		const other = await models.GtmProduct.create({
			workspaceId: otherTenant.workspace._id,
			url: "https://birch.test",
			onboardingStatus: "ready",
		});
		const { saveCandidates } = await import("@/lib/gtm/radar-store");

		await save([candidate()]);
		await saveCandidates({ workspaceId: other.workspaceId, productId: other._id, candidates: [candidate()] });

		// The unique index is per product: one person's opportunity is not another's duplicate.
		assert.equal(await models.GtmOpportunity.countDocuments({}), 2);
	});

	test("text from a stranger is cut to what the schema allows", async () => {
		await save([
			candidate({
				text: "x".repeat(25_000),
				author: "a".repeat(400),
				keywords: ["k".repeat(200), "", "  "],
			}),
		]);

		const row = await models.GtmOpportunity.findOne({}).lean();
		assert.equal(row.text.length, 20_000);
		assert.equal(row.author.length, 200);
		// Empty keywords are dropped rather than stored as blanks.
		assert.deepEqual(row.keywords, ["k".repeat(80)]);
	});

	test("nothing found writes nothing", async () => {
		assert.deepEqual(await save([]), { created: 0, updated: 0, total: 0 });
		assert.equal(await models.GtmOpportunity.countDocuments({}), 0);
	});
});

describe("the queue", () => {
	async function opportunity(externalId, overrides = {}) {
		return models.GtmOpportunity.create({
			workspaceId: tenant.workspace._id,
			productId: product._id,
			platform: "hn",
			externalId,
			url: `https://news.ycombinator.com/item?id=${externalId}`,
			text: "GA4 is confusing.",
			postedAt: new Date("2026-11-07T12:00:00.000Z"),
			...overrides,
		});
	}

	test("the best post comes first, and an unscored one comes last rather than vanishing", async () => {
		const { listOpportunities } = await import("@/lib/gtm/radar-store");
		await opportunity("low", { score: 20 });
		await opportunity("high", { score: 85 });
		// A batch the scorer could not reach. Hiding it would make a failed batch look like a quiet day.
		await opportunity("unscored");

		const queue = await listOpportunities({ productId: product._id });

		assert.deepEqual(
			queue.map((row) => row.externalId),
			["high", "low", "unscored"]
		);
	});

	test("a post the founder has handled is out of the queue", async () => {
		const { listOpportunities, setOpportunityStatus } = await import("@/lib/gtm/radar-store");
		const row = await opportunity("skip-me", { score: 90 });

		const { changed } = await setOpportunityStatus({ productId: product._id, opportunityId: row._id, status: "skipped" });

		assert.equal(changed, true);
		assert.equal((await listOpportunities({ productId: product._id })).length, 0);
		assert.equal((await listOpportunities({ productId: product._id, status: "skipped" })).length, 1);
	});

	test("another product's post cannot be moved by guessing its id", async () => {
		const { setOpportunityStatus } = await import("@/lib/gtm/radar-store");
		const otherTenant = await makeTenant(models, { name: "Birch", slug: "birch" });
		const other = await models.GtmProduct.create({
			workspaceId: otherTenant.workspace._id,
			url: "https://birch.test",
			onboardingStatus: "ready",
		});
		const row = await opportunity("mine", { score: 90 });

		const { changed } = await setOpportunityStatus({ productId: other._id, opportunityId: row._id, status: "skipped" });

		assert.equal(changed, false);
		assert.equal((await models.GtmOpportunity.findById(row._id).lean()).status, "new");
	});
});

describe("the watermark", () => {
	async function source(overrides = {}) {
		return models.GtmWatchedSource.create({
			workspaceId: tenant.workspace._id,
			productId: product._id,
			platform: "hn",
			url: "https://news.ycombinator.com",
			identifier: "news.ycombinator.com",
			...overrides,
		});
	}

	test("a source starts with no watermark and no error", async () => {
		const row = await source();
		assert.equal(row.lastScanAt, null);
		assert.equal(row.lastError, null);
	});

	test("a scan that worked moves the watermark and clears the last error", async () => {
		const { markSourceScanned } = await import("@/lib/gtm/radar-store");
		const row = await source({ lastError: "Hacker News answered 500" });
		const at = new Date("2026-11-08T12:00:00.000Z");

		await markSourceScanned({ sourceId: row._id, at });

		const saved = await models.GtmWatchedSource.findById(row._id).lean();
		assert.equal(saved.lastScanAt.toISOString(), at.toISOString());
		assert.equal(saved.lastError, null);
	});

	test("a scan that failed records why and leaves the watermark alone", async () => {
		const { markSourceScanned } = await import("@/lib/gtm/radar-store");
		const lastScanAt = new Date("2026-11-08T06:00:00.000Z");
		const row = await source({ lastScanAt });

		await markSourceScanned({
			sourceId: row._id,
			at: new Date("2026-11-08T12:00:00.000Z"),
			error: "Hacker News answered 500",
		});

		const saved = await models.GtmWatchedSource.findById(row._id).lean();
		// Moving it would silently skip the six hours the failed scan was meant to cover.
		assert.equal(saved.lastScanAt.toISOString(), lastScanAt.toISOString());
		assert.match(saved.lastError, /answered 500/);
	});

	test("only active sources on a platform the radar can read are scanned", async () => {
		const { listScannableSources } = await import("@/lib/gtm/radar-store");
		await source();
		await source({ identifier: "off", url: "https://news.ycombinator.com/off", active: false });
		// Stored at onboarding, but no reader exists for it yet.
		await source({ platform: "reddit", identifier: "r/analytics", url: "https://reddit.com/r/analytics" });

		const scannable = await listScannableSources({ productId: product._id });

		assert.equal(scannable.length, 1);
		assert.equal(scannable[0].identifier, "news.ycombinator.com");
	});
});
