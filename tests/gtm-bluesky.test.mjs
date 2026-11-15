import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBlueskySearchUrl, readBlueskyPost, searchBluesky, searchBlueskyKeyword } from "../lib/gtm/sources/bluesky.js";

// The platform that produced the radar's first real opportunity. Two behaviours here exist only because a
// live probe found them: the documented public host refuses search, and paging is refused partway.

function post(id, overrides = {}) {
	const { text = "Looking for a google analytics alternative that doesn't need a cookie banner. Recommendations?", ...rest } = overrides;
	return {
		uri: `at://did:plc:test/app.bsky.feed.post/${id}`,
		author: { handle: "someone.bsky.social" },
		record: { text, createdAt: "2026-11-10T12:00:00.000Z" },
		indexedAt: "2026-11-10T12:00:05.000Z",
		...rest,
	};
}

function fakeFetch(answers) {
	const urls = [];
	const impl = async (url) => {
		urls.push(url);
		const answer = answers.shift() ?? { body: { posts: [] } };
		if (answer.throws) throw Object.assign(new Error("boom"), { name: answer.throws });
		if (answer.status && answer.status !== 200) return { ok: false, status: answer.status };
		return { ok: true, status: 200, json: async () => answer.body };
	};
	return { impl, urls };
}

test("search goes to the host that answers, newest first", () => {
	const url = new URL(buildBlueskySearchUrl({ keyword: " ga4 ", since: new Date("2026-11-01T00:00:00Z") }));

	// public.api.bsky.app is the documented public host and answers search with a 403.
	assert.equal(url.host, "api.bsky.app");
	assert.equal(url.searchParams.get("q"), "ga4");
	assert.equal(url.searchParams.get("sort"), "latest");
	assert.equal(url.searchParams.get("since"), "2026-11-01T00:00:00.000Z");
	assert.equal(url.searchParams.get("limit"), "100");
});

test("a post becomes the same candidate shape the other platforms produce", () => {
	const candidate = readBlueskyPost(post("3abc"), { keywords: ["google analytics alternative", "cookie banner", "stripe"] });

	assert.equal(candidate.platform, "bluesky");
	assert.equal(candidate.externalId, "at://did:plc:test/app.bsky.feed.post/3abc");
	assert.equal(candidate.url, "https://bsky.app/profile/someone.bsky.social/post/3abc");
	assert.equal(candidate.author, "someone.bsky.social");
	assert.equal(candidate.postedAt.toISOString(), "2026-11-10T12:00:00.000Z");
	assert.equal(candidate.storyTitle, "");
	assert.deepEqual(candidate.keywords, ["google analytics alternative", "cookie banner"]);
});

test("a post Bluesky returned but that misses a word of every keyword is not a candidate", () => {
	// Bluesky's own matching is looser than ours; about a quarter of what it returns fails this.
	assert.equal(readBlueskyPost(post("x", { text: "Google released something new" }), { keywords: ["google analytics alternative"] }), null);
	assert.equal(readBlueskyPost(post("x", { uri: "" }), { keywords: ["cookie banner"] }), null);
	assert.equal(readBlueskyPost(post("x", { text: "" }), { keywords: ["cookie banner"] }), null);
});

test("a broken createdAt falls back to when Bluesky saw the post", () => {
	const candidate = readBlueskyPost(post("x", { record: { text: "cookie banner again", createdAt: "not a date" } }), {
		keywords: ["cookie banner"],
	});

	assert.equal(candidate.postedAt.toISOString(), "2026-11-10T12:00:05.000Z");
});

test("paging refused partway keeps what was read instead of failing", async () => {
	const { impl, urls } = fakeFetch([{ body: { posts: [post("a"), post("b")], cursor: "next" } }, { status: 403 }]);

	const result = await searchBlueskyKeyword({ keyword: "cookie banner", limit: 10, fetchImpl: impl });

	assert.equal(result.error, undefined);
	assert.equal(result.candidates.length, 2);
	assert.equal(urls.length, 2);
	assert.equal(new URL(urls[1]).searchParams.get("cursor"), "next");
});

test("a refusal on the first page is a real failure, and so is rate limiting", async () => {
	assert.match((await searchBlueskyKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ status: 403 }]).impl })).error, /answered 403/);
	assert.match((await searchBlueskyKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ status: 429 }]).impl })).error, /rate-limiting us/);
	assert.match(
		(await searchBlueskyKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ throws: "TimeoutError" }]).impl })).error,
		/didn't answer within/
	);
	assert.match((await searchBlueskyKeyword({ keyword: "  " })).error, /keyword is empty/);
});

test("a keyword stops at its limit", async () => {
	const many = { body: { posts: Array.from({ length: 50 }, (_, index) => post(`p${index}`)), cursor: "more" } };
	const { impl, urls } = fakeFetch([many, { ...many }]);

	const { candidates } = await searchBlueskyKeyword({ keyword: "cookie banner", limit: 3, fetchImpl: impl });

	assert.equal(candidates.length, 3);
	assert.equal(urls.length, 1);
});

test("a post two keywords found is kept once and carries every keyword it contains", async () => {
	const { impl } = fakeFetch([{ body: { posts: [post("shared")] } }, { body: { posts: [post("shared")] } }]);

	const { candidates, problems } = await searchBluesky({ keywords: ["google analytics alternative", "cookie banner"], fetchImpl: impl });

	assert.equal(candidates.length, 1);
	assert.deepEqual(candidates[0].keywords, ["google analytics alternative", "cookie banner"]);
	assert.deepEqual(problems, []);
});

test("one failing keyword does not lose what the others found", async () => {
	const { impl } = fakeFetch([{ status: 500 }, { body: { posts: [post("kept", { text: "a cookie banner on every site" })] } }]);

	const { candidates, problems } = await searchBluesky({ keywords: ["ga4", "cookie banner"], fetchImpl: impl });

	assert.equal(candidates.length, 1);
	assert.equal(problems[0].keyword, "ga4");
});

test("no keywords means no requests", async () => {
	const { impl, urls } = fakeFetch([]);
	assert.deepEqual(await searchBluesky({ keywords: [], fetchImpl: impl }), { candidates: [], problems: [] });
	assert.equal(urls.length, 0);
});
