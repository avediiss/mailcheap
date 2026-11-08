import assert from "node:assert/strict";
import { test } from "node:test";
import { GTM_LIMITS } from "../lib/gtm/config.js";
import { buildHnSearchUrl, readHnHit, searchHn, searchHnKeyword } from "../lib/gtm/sources/hn.js";

// The radar's first eyes. What matters here is not that a search returns something — it is that it returns
// little: Algolia's default relevance answers "ga4" with millions of hits, and every hit the radar keeps is
// a post somebody pays to have scored later.

function hit(overrides = {}) {
	return {
		objectID: "50017058",
		author: "someone",
		comment_text: "&gt; the dashboards<p>GA4 is confusing and the script is slow&#x2F;heavy on mobile.",
		created_at_i: 1_793_700_000,
		story_id: 49_995_495,
		story_title: "Ask HN: what analytics do you use?",
		story_url: "https://example.com/thread",
		...overrides,
	};
}

// Answers each request from a queue, and records the URLs it was asked for.
function fakeFetch(pages) {
	const urls = [];
	const impl = async (url) => {
		urls.push(url);
		const body = pages.shift() ?? { hits: [], nbPages: 1 };
		if (body.status && body.status !== 200) return { ok: false, status: body.status };
		if (body.throws) throw Object.assign(new Error("boom"), { name: body.throws });
		if (body.notJson) {
			return {
				ok: true,
				status: 200,
				json: async () => {
					throw new Error("not json");
				},
			};
		}
		return { ok: true, status: 200, json: async () => body };
	};
	return { impl, urls };
}

function params(url) {
	return new URL(url).searchParams;
}

test("every word must appear, spelled correctly, and the keyword is not a phrase", () => {
	const query = params(buildHnSearchUrl({ keyword: "ga4 too complicated" }));

	// Measured over ninety days of comments: "ga4" matches 57,555 with typo tolerance on and 12 with it
	// off. That switch is the difference between an affordable scan and an absurd one.
	assert.equal(query.get("typoTolerance"), "false");
	// Not quoted. A phrase search for a real keyword like "google analytics alternative" matched nothing
	// over the same ninety days, because people write the words in their own order.
	assert.equal(query.get("query"), "ga4 too complicated");
	assert.equal(query.get("advancedSyntax"), null);
	// A comment is not about the keyword just because its story's headline was.
	assert.equal(query.get("restrictSearchableAttributes"), "comment_text");
	assert.equal(query.get("tags"), "comment");
});

test("a keyword carrying quotes cannot turn the search into a phrase search", () => {
	assert.equal(params(buildHnSearchUrl({ keyword: 'ga4" OR everything' })).get("query"), "ga4 OR everything");
	assert.equal(params(buildHnSearchUrl({ keyword: '  "ga4"  ' })).get("query"), "ga4");
});

test("a scan window becomes a numeric filter in whole seconds", () => {
	const since = new Date("2026-11-04T09:30:30.500Z");
	const query = params(buildHnSearchUrl({ keyword: "ga4", since }));

	assert.equal(query.get("numericFilters"), `created_at_i>${Math.floor(since.getTime() / 1000)}`);
	// No window on the first ever scan, rather than a window that quietly means 1970.
	assert.equal(params(buildHnSearchUrl({ keyword: "ga4" })).get("numericFilters"), null);
});

test("a hit becomes a candidate with its markup and entities resolved", () => {
	const candidate = readHnHit(hit(), { keyword: "ga4" });

	assert.equal(candidate.platform, "hn");
	assert.equal(candidate.externalId, "50017058");
	assert.equal(candidate.url, "https://news.ycombinator.com/item?id=50017058");
	assert.equal(candidate.author, "someone");
	// The escaped HTML Hacker News stores is not what a model should be asked to read.
	assert.match(candidate.text, /^> the dashboards/);
	assert.match(candidate.text, /slow\/heavy on mobile\./);
	assert.doesNotMatch(candidate.text, /&gt;|&#x2F;|<p>/);
	assert.equal(candidate.postedAt.getTime(), 1_793_700_000 * 1000);
	assert.equal(candidate.storyTitle, "Ask HN: what analytics do you use?");
	assert.equal(candidate.keyword, "ga4");
});

test("a hit with nothing to read, no id or no time is dropped", () => {
	assert.equal(readHnHit(hit({ objectID: "" })), null);
	assert.equal(readHnHit(hit({ comment_text: "" })), null);
	assert.equal(readHnHit(hit({ comment_text: "<p></p>" })), null);
	assert.equal(readHnHit(hit({ created_at_i: 0 })), null);
	assert.equal(readHnHit(hit({ created_at_i: "not a time" })), null);
	assert.equal(readHnHit(null), null);
});

test("one keyword stops at its limit rather than reading the archive", async () => {
	const many = { hits: Array.from({ length: 50 }, (_, index) => hit({ objectID: String(index) })), nbPages: 400 };
	const { impl, urls } = fakeFetch([many, { ...many }]);

	const { candidates } = await searchHnKeyword({ keyword: "ga4", limit: 3, fetchImpl: impl });

	assert.equal(candidates.length, 3);
	// One page was enough for three, so a second was never asked for.
	assert.equal(urls.length, 1);
});

test("it pages on only while it needs more and more exists", async () => {
	const page = (ids) => ({ hits: ids.map((id) => hit({ objectID: id })), nbPages: 2 });
	const { impl, urls } = fakeFetch([page(["1", "2"]), page(["3", "4"])]);

	const { candidates } = await searchHnKeyword({ keyword: "ga4", limit: 10, fetchImpl: impl });

	assert.deepEqual(
		candidates.map((candidate) => candidate.externalId),
		["1", "2", "3", "4"]
	);
	assert.equal(urls.length, 2);
	assert.equal(params(urls[1]).get("page"), "1");
});

test("the last page ends the search even when the limit is not reached", async () => {
	const { impl, urls } = fakeFetch([{ hits: [hit()], nbPages: 1 }]);
	const { candidates } = await searchHnKeyword({ keyword: "ga4", limit: 25, fetchImpl: impl });

	assert.equal(candidates.length, 1);
	assert.equal(urls.length, 1);
});

test("a refusal, a timeout and nonsense are reported, not thrown", async () => {
	const refused = await searchHnKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ status: 429 }]).impl });
	assert.match(refused.error, /answered 429/);

	const timedOut = await searchHnKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ throws: "TimeoutError" }]).impl });
	assert.match(timedOut.error, /didn't answer within 10 seconds/);

	const unreachable = await searchHnKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ throws: "TypeError" }]).impl });
	assert.match(unreachable.error, /couldn't be reached/);

	const garbage = await searchHnKeyword({ keyword: "ga4", fetchImpl: fakeFetch([{ notJson: true }]).impl });
	assert.match(garbage.error, /didn't answer with JSON/);

	assert.match((await searchHnKeyword({ keyword: "  " })).error, /keyword is empty/);
});

test("a post found by several keywords is kept once, with all of them", async () => {
	const shared = { hits: [hit({ objectID: "shared" })], nbPages: 1 };
	const { impl } = fakeFetch([shared, { ...shared }]);

	const { candidates } = await searchHn({ keywords: ["ga4", "google analytics alternative"], tagsToSearch: ["comment"], fetchImpl: impl });

	assert.equal(candidates.length, 1);
	assert.deepEqual(candidates[0].keywords, ["ga4", "google analytics alternative"]);
	// The single-keyword field is gone: a candidate carries the list, so nothing downstream reads one and
	// quietly ignores the rest.
	assert.equal(candidates[0].keyword, undefined);
});

test("one failing keyword does not lose what the others found", async () => {
	const { impl } = fakeFetch([{ status: 500 }, { hits: [hit({ objectID: "kept" })], nbPages: 1 }]);

	const { candidates, problems } = await searchHn({ keywords: ["broken", "works"], tagsToSearch: ["comment"], fetchImpl: impl });

	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].externalId, "kept");
	assert.equal(problems.length, 1);
	assert.equal(problems[0].keyword, "broken");
	assert.match(problems[0].error, /answered 500/);
});

test("candidates come back newest first", async () => {
	const older = { hits: [hit({ objectID: "older", created_at_i: 1_793_600_000 })], nbPages: 1 };
	const newer = { hits: [hit({ objectID: "newer", created_at_i: 1_793_700_000 })], nbPages: 1 };
	const { impl } = fakeFetch([older, newer]);

	const { candidates } = await searchHn({ keywords: ["a", "b"], tagsToSearch: ["comment"], fetchImpl: impl });

	assert.deepEqual(
		candidates.map((candidate) => candidate.externalId),
		["newer", "older"]
	);
});

test("a story is read as well as a comment, because it is a different genre", () => {
	// Someone asking "what should I use instead of GA4" posts a story, not a comment. Reading only
	// comments quietly excludes every request for a recommendation on the platform.
	const candidate = readHnHit({
		objectID: "77",
		author: "asker",
		title: "Ask HN: what should I use instead of GA4?",
		story_text: "I want numbers without a &lt;cookie banner&gt;.",
		url: "https://example.com/submitted",
		created_at_i: 1_793_700_000,
	});

	assert.match(candidate.text, /^Ask HN: what should I use instead of GA4\?/);
	assert.match(candidate.text, /without a <cookie banner>/);
	// Its own title is its context, so the megathread filter still sees a title on both kinds.
	assert.equal(candidate.storyTitle, "Ask HN: what should I use instead of GA4?");
	assert.equal(candidate.url, "https://news.ycombinator.com/item?id=77");
});

test("a story search matches the headline, a comment search does not", () => {
	assert.equal(params(buildHnSearchUrl({ keyword: "ga4", tags: "story" })).get("restrictSearchableAttributes"), "title,story_text");
	assert.equal(params(buildHnSearchUrl({ keyword: "ga4" })).get("restrictSearchableAttributes"), "comment_text");
});

test("both kinds are searched for every keyword", async () => {
	const page = { hits: [hit()], nbPages: 1 };
	const { impl, urls } = fakeFetch([page, { hits: [hit({ objectID: "story-1" })], nbPages: 1 }]);

	await searchHn({ keywords: ["ga4"], fetchImpl: impl });

	assert.equal(urls.length, 2);
	assert.deepEqual(
		urls.map((url) => params(url).get("tags")),
		["comment", "story"]
	);
});

test("no keywords means no requests at all", async () => {
	const { impl, urls } = fakeFetch([]);
	const { candidates, problems } = await searchHn({ keywords: [], fetchImpl: impl });

	assert.deepEqual(candidates, []);
	assert.deepEqual(problems, []);
	assert.equal(urls.length, 0);
});

test("the per-keyword limit is a real ceiling, not a suggestion", () => {
	// The cost gate starts here: whatever a keyword matches, this is what a scan carries forward.
	assert.ok(GTM_LIMITS.maxCandidatesPerKeyword > 0);
	assert.ok(GTM_LIMITS.maxCandidatesPerKeyword <= GTM_LIMITS.maxScoredPerScan);
	assert.ok(GTM_LIMITS.searchTimeoutMs > 0);
});
