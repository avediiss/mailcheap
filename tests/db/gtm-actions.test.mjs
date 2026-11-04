import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { catching, loginAs, logout, makeTenant, startDb } from "./helpers.mjs";
import { queueAiAnswers } from "./stubs/anthropic.mjs";

// Phase 4 is the UI, and what a test can hold it to is the server side of it: every action refuses without
// the flag or a session, says plainly when the AI key is missing, and never lets an id from the browser
// reach another workspace's data. The real server actions run here, against a real database.
//
// The page component itself is not rendered: this harness runs plain Node with no JSX transform, so
// importing app/(app)/gtm/page.js fails to parse. `npm run build` is what proves the page compiles, and the
// flag check it does is the same isGtmEnabled() the actions below are held to.

let db;
let models;
let tenant;

const KEYWORDS = ["invoicing", "late payments", "freelance accounting", "chasing invoices", "payment reminders", "self-employed", "contractor billing", "cash flow"];
const sample = (word) => `${word}: the kind of thing the founder actually wrote, long enough to hear a voice in it.`.padEnd(120, ".");

function profileJson() {
	return {
		one_line_pitch: "Invoicing that chases late payers.",
		target_customer: "Freelance designers.",
		pains: ["One.", "Two.", "Three."],
		differentiators: "It chases for you.",
		keywords: KEYWORDS,
		suggested_communities: [],
	};
}

const PAGE = `<title>Acme</title>
	<p>Invoicing that chases late payers so freelancers do not have to. Built for designers who bill a
	handful of clients each month and hate writing the reminder email.</p>
	<p>Connect your bank, send an invoice, and let it do the chasing in your own words. Every reminder
	goes out in the tone you set and stops the moment the client pays.</p>
	<p>No contracts and nothing to install. Most people send their first invoice within minutes.</p>`;

async function withFetch(run) {
	const original = globalThis.fetch;
	globalThis.fetch = async () => new Response(PAGE, { headers: { "content-type": "text/html" } });
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
	}
}

before(async () => {
	db = await startDb();
	models = db.models;
});

after(async () => {
	await db.stop();
	delete process.env.GTM_ENABLED;
	delete process.env.ANTHROPIC_API_KEY;
});

beforeEach(async () => {
	await db.reset();
	process.env.GTM_ENABLED = "true";
	process.env.ANTHROPIC_API_KEY = "sk-ant-test";
	tenant = await makeTenant(models, { name: "Acme", slug: "acme" });
});

async function signIn(user, workspace) {
	const { jar, WORKSPACE_COOKIE } = await loginAs(user);
	jar.set(WORKSPACE_COOKIE, String(workspace._id));
}

describe("the actions check the flag themselves", () => {
	// A server action is reachable by POST whether or not a page links to it, so the flag can't live only
	// in the page.
	test("every one of them refuses with the module off", async () => {
		delete process.env.GTM_ENABLED;
		await signIn(tenant.owner, tenant.workspace);
		const actions = await import("@/app/(app)/gtm/actions");

		const results = await Promise.all([
			actions.readSite({ url: "acme.test" }),
			actions.askInterviewQuestions(),
			actions.submitInterviewAnswers({ interviewId: String(tenant.workspace._id), answers: [] }),
			actions.saveProductProfile({ oneLinePitch: "x" }),
			actions.addWatchedSources({ urls: ["https://x.com/acme"] }),
			actions.toggleWatchedSource({ sourceId: String(tenant.workspace._id), active: false }),
			actions.saveVoice({ texts: [sample("a"), sample("b"), sample("c")] }),
		]);

		for (const result of results) {
			assert.match(result.error, /isn't switched on/);
		}
		assert.equal(await models.GtmProduct.countDocuments({}), 0, "nothing was written");
	});

	test("without a session they send you to the login page", async () => {
		logout();
		const actions = await import("@/app/(app)/gtm/actions");

		const { redirectTo } = await catching(() => actions.saveProductProfile({ oneLinePitch: "x" }));
		assert.equal(redirectTo, "/login");
	});

	test("the AI steps say the key is missing instead of failing obscurely", async () => {
		delete process.env.ANTHROPIC_API_KEY;
		await signIn(tenant.owner, tenant.workspace);
		const actions = await import("@/app/(app)/gtm/actions");

		assert.match((await actions.readSite({ url: "acme.test" })).error, /ANTHROPIC_API_KEY/);
		assert.match((await actions.askInterviewQuestions()).error, /ANTHROPIC_API_KEY/);
	});

	test("the founder can still fill the profile in by hand without a key", async () => {
		await signIn(tenant.owner, tenant.workspace);
		const actions = await import("@/app/(app)/gtm/actions");
		queueAiAnswers({ json: profileJson() });
		await withFetch(() => actions.readSite({ url: "acme.test" }));

		delete process.env.ANTHROPIC_API_KEY;
		const saved = await actions.saveProductProfile({
			name: "Acme",
			oneLinePitch: "Mine, typed by hand.",
			targetCustomer: "Freelance designers.",
			differentiators: "It chases for you.",
			pains: ["One.", "Two.", "Three."],
			keywords: KEYWORDS,
		});

		assert.equal(saved.error, undefined);
		const product = await models.GtmProduct.findOne({}).lean();
		assert.equal(product.oneLinePitch, "Mine, typed by hand.");
	});
});

describe("ids from the browser", () => {
	test("a malformed id is refused before it reaches the database", async () => {
		await signIn(tenant.owner, tenant.workspace);
		const actions = await import("@/app/(app)/gtm/actions");

		assert.match((await actions.toggleWatchedSource({ sourceId: "not-an-id", active: false })).error, /gone/);
		assert.match((await actions.submitInterviewAnswers({ interviewId: "not-an-id", answers: [] })).error, /gone/);
	});

	test("another workspace's source can't be switched off", async () => {
		await signIn(tenant.owner, tenant.workspace);
		const actions = await import("@/app/(app)/gtm/actions");
		queueAiAnswers({ json: profileJson() });
		await withFetch(() => actions.readSite({ url: "acme.test" }));
		await actions.addWatchedSources({ urls: ["https://x.com/acme"] });
		const [acmeSource] = await models.GtmWatchedSource.find({}).lean();

		// A second workspace, signed in, holding Acme's source id.
		const other = await makeTenant(models, { name: "Other", slug: "other" });
		await signIn(other.owner, other.workspace);

		const result = await actions.toggleWatchedSource({ sourceId: String(acmeSource._id), active: false });

		assert.match(result.error, /gone/);
		const after = await models.GtmWatchedSource.findById(acmeSource._id).lean();
		assert.equal(after.active, true, "still watched");
	});
});
