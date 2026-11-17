import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
	buildRedditListingUrl,
	forgetRedditToken,
	getRedditToken,
	matchingKeywords,
	readRedditPost,
	readSubreddit,
	searchReddit,
} from "../lib/gtm/sources/reddit.js";

// The second platform, and the one that proves the first was built right: if the filter, the scorer and
// the store need no changes to take Reddit posts, the candidate shape was the correct boundary.

const ENV = { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret" };

beforeEach(() => {
	forgetRedditToken();
});

function post(overrides = {}) {
	return {
		data: {
			name: "t3_abc123",
			title: "What should I use instead of GA4?",
			selftext: "Google Analytics is overkill for my blog and I want to drop the cookie banner.",
			author: "someone",
			created_utc: 1_793_700_000,
			permalink: "/r/analytics/comments/abc123/what_should_i_use/",
			url: "https://www.reddit.com/r/analytics/comments/abc123/what_should_i_use/",
			subreddit: "analytics",
			...overrides,
		},
	};
}

// Answers each request from a queue, recording what was asked and with which headers.
function fakeFetch(answers) {
	const calls = [];
	const impl = async (url, options = {}) => {
		calls.push({ url, options });
		const answer = answers.shift() ?? { body: { data: { children: [], after: null } } };
		if (answer.throws) throw Object.assign(new Error("boom"), { name: answer.throws });
		if (answer.status && answer.status !== 200) return { ok: false, status: answer.status };
		if (answer.notJson) {
			return {
				ok: true,
				status: 200,
				json: async () => {
					throw new Error("not json");
				},
			};
		}
		return { ok: true, status: 200, json: async () => answer.body };
	};
	return { impl, calls };
}

const tokenAnswer = { body: { access_token: "a-token", expires_in: 3600 } };

test("without credentials Reddit is simply off, not broken", async () => {
	const result = await getRedditToken({ env: {}, fetchImpl: async () => assert.fail("must not call Reddit") });

	assert.match(result.error, /REDDIT_CLIENT_ID/);
});

test("the token is asked for once and reused", async () => {
	const { impl, calls } = fakeFetch([tokenAnswer]);

	const first = await getRedditToken({ env: ENV, fetchImpl: impl });
	const second = await getRedditToken({ env: ENV, fetchImpl: impl });

	assert.equal(first.value, "a-token");
	assert.equal(second.value, "a-token");
	// A token lasts an hour; asking again per subreddit would be rude and slow.
	assert.equal(calls.length, 1);
	assert.match(calls[0].options.headers.Authorization, /^Basic /);
	assert.equal(calls[0].options.body, "grant_type=client_credentials");
	// Reddit asks for an agent that says who is calling.
	assert.match(calls[0].options.headers["User-Agent"], /Namag/);
});

test("a token about to expire is replaced rather than used", async () => {
	const { impl, calls } = fakeFetch([
		{ body: { access_token: "short", expires_in: 60 } },
		{ body: { access_token: "fresh", expires_in: 3600 } },
	]);

	await getRedditToken({ env: ENV, fetchImpl: impl, now: 0 });
	const later = await getRedditToken({ env: ENV, fetchImpl: impl, now: 30_000 });

	assert.equal(later.value, "fresh");
	assert.equal(calls.length, 2);
});

test("bad credentials say so, and are not confused with a user's", async () => {
	const refused = await getRedditToken({ env: ENV, fetchImpl: fakeFetch([{ status: 401 }]).impl });
	assert.match(refused.error, /app credentials \(401\)/);

	forgetRedditToken();
	const timedOut = await getRedditToken({ env: ENV, fetchImpl: fakeFetch([{ throws: "TimeoutError" }]).impl });
	assert.match(timedOut.error, /didn't answer in time/);

	forgetRedditToken();
	const empty = await getRedditToken({ env: ENV, fetchImpl: fakeFetch([{ body: {} }]).impl });
	assert.match(empty.error, /no token/);
});

test("a keyword matches when all of its words appear, in any order", () => {
	const text = "I want analytics without a cookie banner on my site";

	assert.deepEqual(matchingKeywords(text, ["cookie analytics"]), ["cookie analytics"]);
	assert.deepEqual(matchingKeywords(text, ["analytics without cookie"]), ["analytics without cookie"]);
	// Not a phrase search, and not an OR: one missing word is no match.
	assert.deepEqual(matchingKeywords(text, ["google analytics"]), []);
	assert.deepEqual(matchingKeywords("GA4 IS LOUD", ["ga4"]), ["ga4"]);
	assert.deepEqual(matchingKeywords(text, ["", "   "]), []);
	assert.deepEqual(matchingKeywords(null, ["a"]), []);
});

test("a submission becomes the same candidate shape Hacker News produces", () => {
	const candidate = readRedditPost(post(), { keywords: ["ga4", "cookie banner", "stripe"] });

	assert.equal(candidate.platform, "reddit");
	assert.equal(candidate.externalId, "t3_abc123");
	assert.equal(candidate.url, "https://www.reddit.com/r/analytics/comments/abc123/what_should_i_use/");
	assert.equal(candidate.author, "someone");
	assert.match(candidate.text, /^What should I use instead of GA4\?/);
	assert.match(candidate.text, /drop the cookie banner/);
	assert.equal(candidate.postedAt.getTime(), 1_793_700_000 * 1000);
	// Its own title is its context, so the megathread filter works on Reddit too.
	assert.equal(candidate.storyTitle, "What should I use instead of GA4?");
	// Only the keywords that actually matched, which is what the scorer and the founder are shown.
	assert.deepEqual(candidate.keywords, ["ga4", "cookie banner"]);
});

test("a post matching no keyword is not a candidate", () => {
	assert.equal(readRedditPost(post(), { keywords: ["stripe", "invoicing"] }), null);
	assert.equal(readRedditPost(post({ name: "" }), { keywords: ["ga4"] }), null);
	assert.equal(readRedditPost(post({ title: "", selftext: "" }), { keywords: ["ga4"] }), null);
	assert.equal(readRedditPost(post({ created_utc: 0 }), { keywords: ["ga4"] }), null);
});

test("the listing is asked for by name, however the founder wrote it", () => {
	assert.match(buildRedditListingUrl({ subreddit: "r/analytics" }), /\/r\/analytics\/new\?/);
	assert.match(buildRedditListingUrl({ subreddit: "/r/analytics" }), /\/r\/analytics\/new\?/);
	assert.match(buildRedditListingUrl({ subreddit: "analytics" }), /\/r\/analytics\/new\?/);
	// raw_json keeps Reddit from sending &amp; where an ampersand belongs.
	assert.match(buildRedditListingUrl({ subreddit: "analytics" }), /raw_json=1/);
	assert.match(buildRedditListingUrl({ subreddit: "analytics", limit: 500 }), /limit=100/);
});

test("reading a subreddit stops at the scan window", async () => {
	const since = new Date("2026-11-07T00:00:00.000Z");
	const inside = Math.floor(new Date("2026-11-07T12:00:00.000Z").getTime() / 1000);
	const outside = Math.floor(new Date("2026-11-06T12:00:00.000Z").getTime() / 1000);
	const { impl, calls } = fakeFetch([
		{
			body: {
				data: {
					children: [post({ name: "t3_new", created_utc: inside }), post({ name: "t3_old", created_utc: outside })],
					after: "t3_old",
				},
			},
		},
	]);

	const { candidates } = await readSubreddit({ subreddit: "analytics", keywords: ["ga4"], since, token: "t", fetchImpl: impl });

	assert.deepEqual(
		candidates.map((candidate) => candidate.externalId),
		["t3_new"]
	);
	// Newest first, so the first old post ends the subreddit: there is no point asking for page two.
	assert.equal(calls.length, 1);
	assert.match(calls[0].options.headers.Authorization, /^Bearer t$/);
});

test("rate limiting and refusals are reported, not thrown", async () => {
	const limited = await readSubreddit({ subreddit: "analytics", keywords: ["ga4"], token: "t", fetchImpl: fakeFetch([{ status: 429 }]).impl });
	assert.match(limited.error, /rate-limiting us on r\/analytics \(429\)/);

	const gone = await readSubreddit({ subreddit: "analytics", keywords: ["ga4"], token: "t", fetchImpl: fakeFetch([{ status: 404 }]).impl });
	assert.match(gone.error, /answered 404/);

	const garbage = await readSubreddit({ subreddit: "analytics", keywords: ["ga4"], token: "t", fetchImpl: fakeFetch([{ notJson: true }]).impl });
	assert.match(garbage.error, /didn't answer with JSON/);
});

test("one failing subreddit does not lose what the others found", async () => {
	const { impl } = fakeFetch([tokenAnswer, { status: 403 }, { body: { data: { children: [post({ name: "t3_kept" })], after: null } } }]);

	const { candidates, problems } = await searchReddit({
		subreddits: ["private", "analytics"],
		keywords: ["ga4"],
		env: ENV,
		fetchImpl: impl,
	});

	assert.deepEqual(
		candidates.map((candidate) => candidate.externalId),
		["t3_kept"]
	);
	assert.equal(problems.length, 1);
	assert.equal(problems[0].subreddit, "private");
});

test("with Reddit unconfigured a scan returns nothing and says why, without failing", async () => {
	const { candidates, problems } = await searchReddit({
		subreddits: ["analytics"],
		keywords: ["ga4"],
		env: {},
		fetchImpl: async () => assert.fail("must not call Reddit"),
	});

	assert.deepEqual(candidates, []);
	assert.match(problems[0].error, /not configured/);
});

test("no subreddits or no keywords means no requests at all", async () => {
	const { impl, calls } = fakeFetch([]);

	await searchReddit({ subreddits: [], keywords: ["ga4"], env: ENV, fetchImpl: impl });
	await searchReddit({ subreddits: ["analytics"], keywords: [], env: ENV, fetchImpl: impl });

	assert.equal(calls.length, 0);
});
