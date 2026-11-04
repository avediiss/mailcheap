import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { makeTenant, startDb } from "./helpers.mjs";
import { aiCalls, queueAiAnswers } from "./stubs/anthropic.mjs";

// Phase 3 is the onboarding backend, so this runs the real services against a real database with the AI
// replaced by a recorder: the profile is validated and retried, every call is logged to gtm_ai_usage with
// its cost, progress is saved after each step, and nothing crosses a workspace boundary.

let db;
let models;
let tenant;

const KEYWORDS = ["invoicing", "late payments", "freelance accounting", "chasing invoices", "payment reminders", "self-employed", "contractor billing", "cash flow"];

function profileJson(overrides = {}) {
	return {
		one_line_pitch: "Invoicing that chases late payers for freelancers.",
		target_customer: "Freelance designers billing a few clients a month.",
		pains: ["Clients pay late.", "Chasing feels rude.", "Spreadsheets lose track."],
		differentiators: "It sends the reminders for you, in your own words.",
		keywords: KEYWORDS,
		suggested_communities: ["r/freelance", "news.ycombinator.com"],
		...overrides,
	};
}

const PAGE = `<title>Acme</title><nav><a href="/pricing">Pricing</a></nav>
	<p>Invoicing that chases late payers so freelancers do not have to. Built for designers who bill a
	handful of clients each month and hate writing the reminder email.</p>
	<p>Connect your bank, send an invoice, and let it do the chasing in your own words. Every reminder
	goes out in the tone you set and stops the moment the client pays.</p>
	<p>No contracts and nothing to install. Most people send their first invoice within minutes.</p>`;

// The founder's site, without a network.
function fakeSite(pages = { "https://acme.test/": PAGE }) {
	return async (url) => {
		const html = pages[String(url)];
		return new Response(html ?? "gone", { status: html ? 200 : 404, headers: { "content-type": "text/html" } });
	};
}

const sample = (word) => `${word}: the kind of thing the founder actually wrote, long enough to hear a voice in it.`.padEnd(120, ".");

before(async () => {
	db = await startDb();
	models = db.models;
	process.env.GTM_ENABLED = "true";
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
});

after(async () => {
	await db.stop();
	delete process.env.GTM_ENABLED;
	delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(async () => {
	await db.reset();
	tenant = await makeTenant(models, { name: "Acme", slug: "acme" });
});

async function readSiteStep(overrides = {}) {
	const { readSiteAndExtractProfile } = await import("@/lib/gtm/onboarding");
	return readSiteAndExtractProfile({ workspaceId: tenant.workspace._id, userId: tenant.owner._id, url: "acme.test", ...overrides });
}

describe("step 1: reading the site and extracting a profile", () => {
	test("the site is read, the profile saved, and the step recorded", async () => {
		queueAiAnswers({ json: profileJson() });

		const result = await withFetch(fakeSite(), readSiteStep);

		assert.equal(result.error, undefined);
		assert.equal(result.profile.one_line_pitch, "Invoicing that chases late payers for freelancers.");

		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "site_read");
		assert.equal(product.oneLinePitch, "Invoicing that chases late payers for freelancers.");
		assert.equal(product.keywords.length, 8);
		assert.equal(product.createdBy.toString(), tenant.owner._id.toString());
		assert.match(product.rawSiteText, /chases late payers/, "kept so the profile can be re-extracted");
	});

	test("the communities the AI suggests come back for the founder to accept or ignore", async () => {
		queueAiAnswers({ json: profileJson() });
		const result = await withFetch(fakeSite(), readSiteStep);

		assert.deepEqual(result.suggestedCommunities, ["r/freelance", "news.ycombinator.com"]);
	});

	test("a JavaScript-only site asks the founder instead of guessing, and spends no AI call", async () => {
		const result = await withFetch(fakeSite({ "https://acme.test/": `<div id="root"></div><script>app()</script>` }), readSiteStep);

		assert.equal(result.needsDescription, true);
		assert.equal(aiCalls().length, 0, "nothing was sent to the AI");
		// The product still exists, so the founder comes back to it rather than starting over.
		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.needsDescription, true);
		assert.equal(product.onboardingStatus, "new");
	});

	test("with a pasted description, a thin site is extracted from that instead", async () => {
		queueAiAnswers({ json: profileJson() });
		const result = await withFetch(fakeSite({ "https://acme.test/": `<div id="root"></div>` }), () =>
			readSiteStep({ pastedDescription: "Invoicing for freelancers that chases late payers automatically." })
		);

		assert.equal(result.error, undefined);
		assert.match(aiCalls()[0].messages[0].content, /WHAT THE FOUNDER SAYS IT IS/);
		assert.match(aiCalls()[0].messages[0].content, /chases late payers automatically/);
	});

	test("a site that can't be read says so and writes no product", async () => {
		const result = await withFetch(fakeSite({}), readSiteStep);

		assert.match(result.error, /answered 404/);
		assert.equal(await models.GtmProduct.countDocuments({}), 0);
	});
});

describe("the AI client", () => {
	test("an unusable answer is retried once, and the retry says what was wrong", async () => {
		// First answer has two keywords where eight are required.
		queueAiAnswers({ json: profileJson({ keywords: ["one", "two"] }) }, { json: profileJson() });

		const result = await withFetch(fakeSite(), readSiteStep);

		assert.equal(result.error, undefined);
		assert.equal(aiCalls().length, 2);
		assert.match(aiCalls()[1].messages[0].content, /YOUR LAST ANSWER COULD NOT BE USED/);
		assert.match(aiCalls()[1].messages[0].content, /keywords has 2, needs at least 8/);
	});

	test("two unusable answers give up rather than calling a third time", async () => {
		queueAiAnswers({ text: "I'd be happy to help!" }, { text: "Still not JSON" });

		const result = await withFetch(fakeSite(), readSiteStep);

		assert.match(result.error, /could not give a usable answer/);
		assert.equal(aiCalls().length, 2, "twice is the limit");
	});

	test("a refusal and a cut-off answer are both reported in plain words", async () => {
		queueAiAnswers({ refusal: "cyber" }, { refusal: "cyber" });
		const refused = await withFetch(fakeSite(), readSiteStep);
		assert.match(refused.error, /declined to answer \(cyber\)/);

		await db.reset();
		tenant = await makeTenant(models, { name: "Acme", slug: "acme" });
		queueAiAnswers({ truncated: true }, { truncated: true });
		const truncated = await withFetch(fakeSite(), readSiteStep);
		assert.match(truncated.error, /cut off before it finished/);
	});

	test("the request is built the way this model needs", async () => {
		queueAiAnswers({ json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);
		const [request] = aiCalls();

		assert.equal(request.model, "claude-opus-5-5");
		// Thinking is always on for this model and its depth is set by effort, so neither is sent.
		assert.equal(request.thinking, undefined);
		assert.equal(request.temperature, undefined, "sending it is a 400 on every current model");
		assert.equal(request.output_config.effort, "medium");
		// The shape is enforced, not just asked for in prose.
		assert.equal(request.output_config.format.type, "json_schema");
		assert.equal(request.output_config.format.schema.additionalProperties, false);
		assert.ok(request.max_tokens >= 16_000, "thinking tokens come out of this too");
	});
});

describe("what every call costs", () => {
	test("a successful call is logged with its tokens and a dollar estimate", async () => {
		queueAiAnswers({ json: profileJson(), inputTokens: 12_000, outputTokens: 800 });
		await withFetch(fakeSite(), readSiteStep);

		const rows = await models.GtmAiUsage.find({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(rows.length, 1);
		assert.equal(rows[0].purpose, "profile_extract");
		assert.equal(rows[0].model, "claude-opus-5-5");
		assert.equal(rows[0].inputTokens, 12_000);
		assert.equal(rows[0].outputTokens, 800);
		// 12,000 at $4/M plus 800 at $20/M.
		assert.equal(rows[0].estimatedCostUsd, 0.064);
		assert.equal(rows[0].ok, true);
		assert.ok(rows[0].productId, "tied to the product it was spent on");
		assert.ok(rows[0].durationMs >= 0);
	});

	test("a failed call is logged too, because it still cost something", async () => {
		queueAiAnswers({ json: profileJson({ pains: ["only one"] }) }, { json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);

		const rows = await models.GtmAiUsage.find({}).sort({ createdAt: 1 }).lean();
		assert.equal(rows.length, 2, "the retry is a second billable call");
		assert.equal(rows[0].ok, false);
		assert.match(rows[0].error, /pains has 1/);
		assert.equal(rows[1].ok, true);
	});

	test("a call that threw is logged with no tokens and the reason", async () => {
		// One throw, one row: a call that never produced an answer is not asked again.
		queueAiAnswers({ throws: "connection reset" });
		const result = await withFetch(fakeSite(), readSiteStep);

		assert.match(result.error, /connection reset/);
		const rows = await models.GtmAiUsage.find({}).lean();
		assert.equal(rows.length, 1);
		assert.equal(rows[0].ok, false);
		assert.equal(rows[0].inputTokens, 0);
		assert.equal(rows[0].estimatedCostUsd, 0, "no tokens is a real zero, unlike an unpriced model");
	});

	test("the model that actually answered is the one billed, not the one asked for", async () => {
		// A fallback can answer on a different model; the cost model has to follow the money.
		queueAiAnswers({ json: profileJson(), model: "claude-haiku-5-5", inputTokens: 10_000, outputTokens: 1_000 });
		await withFetch(fakeSite(), readSiteStep);

		const [row] = await models.GtmAiUsage.find({}).lean();
		assert.equal(row.model, "claude-haiku-5-5");
		assert.equal(row.estimatedCostUsd, 0.0015);
	});
});

describe("steps 2 and 3: the interview and the founder's edits", () => {
	async function throughStepOne() {
		queueAiAnswers({ json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);
	}

	test("the interview is asked, stored, and its answers fold back into the profile", async () => {
		await throughStepOne();
		const { answerInterview, startInterview } = await import("@/lib/gtm/onboarding");

		queueAiAnswers({ json: { questions: ["Who pays for this?", "What breaks without it?", "Why not a spreadsheet?"] } });
		const asked = await startInterview({ workspaceId: tenant.workspace._id });
		assert.equal(asked.questions.length, 3);

		queueAiAnswers({ json: profileJson({ one_line_pitch: "Invoicing for design studios that bill retainers." }) });
		const answered = await answerInterview({
			workspaceId: tenant.workspace._id,
			interviewId: asked.interviewId,
			answers: ["Studio owners.", "They forget to invoice at all.", "A spreadsheet never chases anyone."],
		});

		assert.equal(answered.refined, true);
		const interview = await models.GtmOnboardingInterview.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(interview.answers.length, 3);
		assert.ok(interview.answeredAt, "recorded as answered");

		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "interviewed");
		assert.equal(product.oneLinePitch, "Invoicing for design studios that bill retainers.");
	});

	test("answers are saved before the AI is called, so a failed call doesn't lose the typing", async () => {
		await throughStepOne();
		const { answerInterview, startInterview } = await import("@/lib/gtm/onboarding");

		queueAiAnswers({ json: { questions: ["A?", "B?", "C?"] } });
		const asked = await startInterview({ workspaceId: tenant.workspace._id });

		queueAiAnswers({ throws: "the AI is down" });
		const answered = await answerInterview({
			workspaceId: tenant.workspace._id,
			interviewId: asked.interviewId,
			answers: ["Studio owners.", "", ""],
		});

		assert.ok(answered.error);
		const interview = await models.GtmOnboardingInterview.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.deepEqual(interview.answers, ["Studio owners.", "", ""]);
	});

	test("every answer left blank costs no AI call and still finishes the step", async () => {
		await throughStepOne();
		const { answerInterview, startInterview } = await import("@/lib/gtm/onboarding");

		queueAiAnswers({ json: { questions: ["A?", "B?", "C?"] } });
		const asked = await startInterview({ workspaceId: tenant.workspace._id });
		const callsBefore = aiCalls().length;

		const answered = await answerInterview({ workspaceId: tenant.workspace._id, interviewId: asked.interviewId, answers: ["", "  ", ""] });

		assert.equal(answered.refined, false);
		assert.equal(aiCalls().length, callsBefore, "nothing to refine, so nothing was asked");
		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "interviewed");
	});

	test("the founder's own edits are saved without re-asking the AI", async () => {
		await throughStepOne();
		const { saveProfile } = await import("@/lib/gtm/onboarding");
		const callsBefore = aiCalls().length;

		const saved = await saveProfile({
			workspaceId: tenant.workspace._id,
			fields: {
				name: "Acme Invoicing",
				oneLinePitch: "What the founder actually wants it to say.",
				targetCustomer: "Freelance designers.",
				pains: ["One.", "Two.", "Three."],
				differentiators: "Mine, not the AI's.",
				keywords: KEYWORDS,
			},
		});

		assert.equal(saved.error, undefined);
		assert.equal(aiCalls().length, callsBefore);
		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.oneLinePitch, "What the founder actually wants it to say.");
		assert.equal(product.name, "Acme Invoicing");
		assert.equal(product.onboardingStatus, "profile_reviewed");
	});

	test("an edit that empties a required field is refused", async () => {
		await throughStepOne();
		const { saveProfile } = await import("@/lib/gtm/onboarding");

		const saved = await saveProfile({
			workspaceId: tenant.workspace._id,
			fields: { oneLinePitch: "", targetCustomer: "Someone.", pains: ["A.", "B.", "C."], differentiators: "X.", keywords: KEYWORDS },
		});
		assert.match(saved.error, /one_line_pitch is empty/);
	});
});

describe("steps 4 and 5: sources and voice", () => {
	async function throughStepOne() {
		queueAiAnswers({ json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);
	}

	test("pasted links are stored with their platform, and the rejects reported", async () => {
		await throughStepOne();
		const { saveWatchedSources } = await import("@/lib/gtm/onboarding");

		const result = await saveWatchedSources({
			workspaceId: tenant.workspace._id,
			urls: ["https://x.com/acme", "@acme", "https://reddit.com/r/freelance", "nonsense"],
		});

		assert.equal(result.sources.length, 2, "the same X account twice is one source");
		assert.equal(result.problems.length, 1);
		const stored = await models.GtmWatchedSource.find({ workspaceId: tenant.workspace._id }).lean();
		assert.deepEqual(stored.map(({ platform }) => platform).sort(), ["reddit", "x"]);
		assert.ok(stored.every(({ active }) => active));

		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "sources_added");
	});

	test("pasting the same list again updates rather than failing on the unique index", async () => {
		await throughStepOne();
		const { saveWatchedSources } = await import("@/lib/gtm/onboarding");

		await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["https://x.com/acme"] });
		const again = await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["https://twitter.com/acme"] });

		assert.equal(again.error, undefined);
		assert.equal(await models.GtmWatchedSource.countDocuments({}), 1);
	});

	test("a source is switched off rather than deleted", async () => {
		await throughStepOne();
		const { saveWatchedSources, setWatchedSourceActive } = await import("@/lib/gtm/onboarding");
		await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["https://x.com/acme"] });
		const [source] = await models.GtmWatchedSource.find({}).lean();

		await setWatchedSourceActive({ workspaceId: tenant.workspace._id, sourceId: source._id, active: false });

		const after = await models.GtmWatchedSource.findById(source._id).lean();
		assert.equal(after.active, false, "the opportunities it produced aren't orphaned");
	});

	test("nothing usable pasted is an error, not an empty success", async () => {
		await throughStepOne();
		const { saveWatchedSources } = await import("@/lib/gtm/onboarding");

		const result = await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["nonsense", ""] });
		assert.ok(result.error);
		assert.equal(await models.GtmWatchedSource.countDocuments({}), 0);
	});

	test("three to five voice samples finish onboarding", async () => {
		await throughStepOne();
		const { saveVoiceSamples } = await import("@/lib/gtm/onboarding");

		const saved = await saveVoiceSamples({
			workspaceId: tenant.workspace._id,
			texts: [sample("one"), sample("two"), sample("three")],
		});

		assert.equal(saved.error, undefined);
		assert.equal(await models.GtmVoiceSample.countDocuments({ workspaceId: tenant.workspace._id }), 3);
		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "ready");
	});

	test("saving again replaces the set, since the form sends all of them", async () => {
		await throughStepOne();
		const { saveVoiceSamples } = await import("@/lib/gtm/onboarding");

		await saveVoiceSamples({ workspaceId: tenant.workspace._id, texts: [sample("one"), sample("two"), sample("three")] });
		await saveVoiceSamples({ workspaceId: tenant.workspace._id, texts: [sample("four"), sample("five"), sample("six"), sample("seven")] });

		const stored = await models.GtmVoiceSample.find({}).lean();
		assert.equal(stored.length, 4);
		assert.ok(stored.every(({ text }) => !text.startsWith("one")));
	});

	test("a sample too short to copy a voice from is rejected by box", async () => {
		await throughStepOne();
		const { saveVoiceSamples } = await import("@/lib/gtm/onboarding");

		const result = await saveVoiceSamples({ workspaceId: tenant.workspace._id, texts: [sample("one"), "nope", sample("two")] });

		assert.equal(result.problems.length, 1);
		assert.equal(result.problems[0].index, 1);
		assert.equal(await models.GtmVoiceSample.countDocuments({}), 0, "nothing is saved until the set is valid");
	});
});

describe("progress and isolation", () => {
	async function throughStepOne() {
		queueAiAnswers({ json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);
	}

	test("onboarding only moves forward: re-reading the site doesn't undo later steps", async () => {
		await throughStepOne();
		const { saveVoiceSamples } = await import("@/lib/gtm/onboarding");
		await saveVoiceSamples({ workspaceId: tenant.workspace._id, texts: [sample("a"), sample("b"), sample("c")] });

		queueAiAnswers({ json: profileJson() });
		await withFetch(fakeSite(), readSiteStep);

		const product = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.equal(product.onboardingStatus, "ready", "a founder who re-reads their site isn't sent back to step one");
	});

	test("the whole state comes back in one read, for the wizard to resume from", async () => {
		await throughStepOne();
		const { getOnboardingState, saveVoiceSamples, saveWatchedSources, startInterview } = await import("@/lib/gtm/onboarding");
		queueAiAnswers({ json: { questions: ["A?", "B?", "C?"] } });
		await startInterview({ workspaceId: tenant.workspace._id });
		await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["https://x.com/acme"] });
		await saveVoiceSamples({ workspaceId: tenant.workspace._id, texts: [sample("a"), sample("b"), sample("c")] });

		const state = await getOnboardingState({ workspaceId: tenant.workspace._id });

		assert.equal(state.status, "ready");
		assert.equal(state.sources.length, 1);
		assert.equal(state.samples.length, 3);
		assert.equal(state.interview.questions.length, 3);
	});

	test("a workspace that hasn't started gets an empty state, not a crash", async () => {
		const { getOnboardingState } = await import("@/lib/gtm/onboarding");
		const state = await getOnboardingState({ workspaceId: tenant.workspace._id });

		assert.equal(state.product, null);
		assert.equal(state.status, "new");
		assert.deepEqual(state.sources, []);
	});

	test("one workspace can't reach another's onboarding", async () => {
		await throughStepOne();
		const { getOnboardingState, saveProfile, saveWatchedSources } = await import("@/lib/gtm/onboarding");
		await saveWatchedSources({ workspaceId: tenant.workspace._id, urls: ["https://x.com/acme"] });

		const other = await makeTenant(models, { name: "Other", slug: "other" });

		const state = await getOnboardingState({ workspaceId: other.workspace._id });
		assert.equal(state.product, null, "no sight of Acme's product");
		assert.deepEqual(state.sources, []);

		// And nothing can be written into Acme's product from the other workspace.
		const saved = await saveProfile({ workspaceId: other.workspace._id, fields: { oneLinePitch: "Stolen." } });
		assert.match(saved.error, /Read your site first/);
		const acme = await models.GtmProduct.findOne({ workspaceId: tenant.workspace._id }).lean();
		assert.notEqual(acme.oneLinePitch, "Stolen.");
	});

	test("a step taken before the site is read is refused, not half-applied", async () => {
		const { saveVoiceSamples, saveWatchedSources, startInterview } = await import("@/lib/gtm/onboarding");
		const workspaceId = tenant.workspace._id;

		assert.match((await startInterview({ workspaceId })).error, /Read your site first/);
		assert.match((await saveWatchedSources({ workspaceId, urls: ["https://x.com/acme"] })).error, /Read your site first/);
		assert.match((await saveVoiceSamples({ workspaceId, texts: [sample("a"), sample("b"), sample("c")] })).error, /Read your site first/);
		assert.equal(await models.GtmWatchedSource.countDocuments({}), 0);
	});
});

// readSite() reaches the network through global fetch when no fetchImpl is given, which is how the service
// calls it. Swapping it for the length of one call is how the other suites stub an outbound request.
async function withFetch(fetchImpl, run) {
	const original = globalThis.fetch;
	globalThis.fetch = fetchImpl;
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
	}
}
