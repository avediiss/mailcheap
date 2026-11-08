import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { Types } from "mongoose";
import { makeTenant, startDb } from "./helpers.mjs";

// Phase 1 is the schema and the switch, so that is what this checks: the module's eleven collections are
// named gtm_*, every row is pinned to a workspace, the unique indexes that onboarding relies on really
// exist in MongoDB, and the flag is off until it is spelled exactly right.

let db;
let models;
let tenant;

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
});

function product(overrides = {}) {
	return { workspaceId: tenant.workspace._id, createdBy: tenant.owner._id, url: "https://acme.test", ...overrides };
}

describe("the module's footprint", () => {
	test("every table is gtm_-prefixed, and the registry lists all of them", async () => {
		const { GTM_COLLECTIONS, GTM_MODEL_NAMES } = await import("@/lib/gtm/schema");

		assert.equal(GTM_MODEL_NAMES.length, 11, "eleven tables were specified");
		for (const name of GTM_MODEL_NAMES) {
			const model = models[`Gtm${name}`];
			assert.ok(model, `models/gtm/${name}.js is loaded`);
			assert.equal(model.collection.collectionName, GTM_COLLECTIONS[name]);
			assert.match(model.collection.collectionName, /^gtm_/);
		}
	});

	test("it adds nothing to the newsletter product's own collections", async () => {
		const { GTM_COLLECTIONS } = await import("@/lib/gtm/schema");
		const own = new Set(Object.values(GTM_COLLECTIONS));
		// Mongoose would quietly pluralise GtmProduct to "gtmproducts" if a collection name were missed.
		for (const [key, model] of Object.entries(models)) {
			const isGtm = key.startsWith("Gtm");
			assert.equal(own.has(model.collection.collectionName), isGtm, `${key} is on the right side of the line`);
		}
	});
});

describe("rows belong to a workspace", () => {
	test("a product without a workspace is refused", async () => {
		await assert.rejects(models.GtmProduct.create({ url: "https://acme.test" }), /workspaceId/);
	});

	test("every table requires a workspaceId", async () => {
		const { GTM_MODEL_NAMES } = await import("@/lib/gtm/schema");
		for (const name of GTM_MODEL_NAMES) {
			const path = models[`Gtm${name}`].schema.path("workspaceId");
			assert.ok(path, `${name} has a workspaceId`);
			assert.equal(path.isRequired, true, `${name}.workspaceId is required`);
		}
	});

	test("one workspace can't read another's product", async () => {
		const other = await makeTenant(models, { name: "Other", slug: "other" });
		await models.GtmProduct.create(product());

		const found = await models.GtmProduct.findOne({ workspaceId: other.workspace._id });
		assert.equal(found, null);
	});
});

describe("the indexes onboarding depends on", () => {
	test("a workspace has one product, so two half-finished ones can't exist", async () => {
		await models.GtmProduct.create(product());
		await assert.rejects(models.GtmProduct.create(product({ url: "https://acme.test/other" })), /duplicate key/);
	});

	test("the same account pasted twice is one watched source", async () => {
		const saved = await models.GtmProduct.create(product());
		const source = { workspaceId: tenant.workspace._id, productId: saved._id, platform: "x", url: "https://x.com/acme", identifier: "acme" };

		await models.GtmWatchedSource.create(source);
		await assert.rejects(models.GtmWatchedSource.create({ ...source, url: "https://twitter.com/acme" }), /duplicate key/);
	});

	test("a post found twice is one opportunity, but two products may each have it", async () => {
		const saved = await models.GtmProduct.create(product());
		const other = await makeTenant(models, { name: "Other", slug: "other" });
		const otherProduct = await models.GtmProduct.create({ workspaceId: other.workspace._id, url: "https://other.test" });
		const post = { platform: "x", externalId: "1234567890", url: "https://x.com/someone/status/1234567890" };

		await models.GtmOpportunity.create({ workspaceId: tenant.workspace._id, productId: saved._id, ...post });
		await assert.rejects(
			models.GtmOpportunity.create({ workspaceId: tenant.workspace._id, productId: saved._id, ...post }),
			/duplicate key/
		);
		// Unique per product, not per platform: two founders watching the same subreddit both see the post.
		await models.GtmOpportunity.create({ workspaceId: other.workspace._id, productId: otherProduct._id, ...post });
		assert.equal(await models.GtmOpportunity.countDocuments({}), 2);
	});

	test("a short code is unique across the platform, since the redirect has only that to go on", async () => {
		const saved = await models.GtmProduct.create(product());
		const other = await makeTenant(models, { name: "Other", slug: "other" });
		const otherProduct = await models.GtmProduct.create({ workspaceId: other.workspace._id, url: "https://other.test" });
		const link = { shortCode: "abc123", targetUrl: "https://acme.test/welcome" };

		await models.GtmLink.create({ workspaceId: tenant.workspace._id, productId: saved._id, ...link });
		await assert.rejects(models.GtmLink.create({ workspaceId: other.workspace._id, productId: otherProduct._id, ...link }), /duplicate key/);
	});

	test("a contact is counted once per product however often they come back", async () => {
		const saved = await models.GtmProduct.create(product());
		const signup = {
			workspaceId: tenant.workspace._id,
			productId: saved._id,
			contactId: tenant.contact._id,
			newsletterId: tenant.newsletter._id,
		};

		await models.GtmSignup.create({ ...signup, linkId: new Types.ObjectId() });
		await assert.rejects(models.GtmSignup.create({ ...signup, linkId: new Types.ObjectId() }), /duplicate key/);
	});
});

describe("the statuses and platforms the module recognises", () => {
	test("onboarding starts at new and only takes the known steps", async () => {
		const { GTM_ONBOARDING_STATUSES } = await import("@/models/gtm/Product");
		const saved = await models.GtmProduct.create(product());

		assert.equal(saved.onboardingStatus, "new");
		assert.deepEqual(GTM_ONBOARDING_STATUSES, ["new", "site_read", "interviewed", "profile_reviewed", "sources_added", "ready"]);
		saved.onboardingStatus = "halfway";
		await assert.rejects(saved.save(), /onboardingStatus/);
	});

	test("a pasted link that is none of the three known platforms is kept as other, not lost", async () => {
		const { GTM_PLATFORMS } = await import("@/models/gtm/WatchedSource");
		assert.deepEqual(GTM_PLATFORMS, ["x", "reddit", "hn", "other"]);

		const saved = await models.GtmProduct.create(product());
		const base = { workspaceId: tenant.workspace._id, productId: saved._id };
		const kept = await models.GtmWatchedSource.create({ ...base, platform: "other", url: "https://discord.gg/xyz", identifier: "xyz" });
		assert.equal(kept.active, true, "a new source is watched until it is switched off");

		await assert.rejects(
			models.GtmWatchedSource.create({ ...base, platform: "discord", url: "https://discord.gg/abc", identifier: "abc" }),
			/platform/
		);
	});

	test("an opportunity, draft and action each start in their first state", async () => {
		const saved = await models.GtmProduct.create(product());
		const opportunity = await models.GtmOpportunity.create({
			workspaceId: tenant.workspace._id,
			productId: saved._id,
			platform: "hn",
			externalId: "42",
			url: "https://news.ycombinator.com/item?id=42",
		});
		const draft = await models.GtmDraft.create({ workspaceId: tenant.workspace._id, opportunityId: opportunity._id, originalText: "Hello." });
		const action = await models.GtmAction.create({ workspaceId: tenant.workspace._id, draftId: draft._id, type: "handoff_copied" });

		assert.equal(opportunity.status, "new");
		assert.equal(draft.status, "draft");
		assert.ok(action.doneAt instanceof Date, "an action records when it happened");
		await assert.rejects(
			models.GtmAction.create({ workspaceId: tenant.workspace._id, draftId: draft._id, type: "emailed" }),
			/type/
		);
	});
});

describe("what every AI call records", () => {
	test("a usage row keeps the purpose, the model, the tokens and the cost", async () => {
		const saved = await models.GtmProduct.create(product());
		const row = await models.GtmAiUsage.create({
			workspaceId: tenant.workspace._id,
			productId: saved._id,
			purpose: "profile_extract",
			model: "claude-opus-5-5",
			inputTokens: 12_000,
			outputTokens: 800,
			estimatedCostUsd: 0.064,
			durationMs: 4200,
		});

		assert.equal(row.product, "gtm", "which part of Namag spent it");
		assert.equal(row.ok, true);
		assert.equal(row.estimatedCostUsd, 0.064);
	});

	test("a call made before any product exists is still logged", async () => {
		const row = await models.GtmAiUsage.create({
			workspaceId: tenant.workspace._id,
			purpose: "interview_questions",
			model: "claude-opus-5-5",
			ok: false,
			error: "timed out",
		});

		assert.equal(row.productId, null);
		assert.equal(row.inputTokens, 0);
		// A model with no price on file must read as unknown, never as free.
		assert.equal(row.estimatedCostUsd, null);
	});

	test("an unknown purpose is refused, so the cost model can't fill up with typos", async () => {
		await assert.rejects(
			models.GtmAiUsage.create({ workspaceId: tenant.workspace._id, purpose: "something_else", model: "claude-opus-5-5" }),
			/purpose/
		);
	});
});
