import assert from "node:assert/strict";
import { test } from "node:test";
import { readWatchedSource, readWatchedSources } from "../lib/gtm/platforms.js";
import { GTM_PLATFORMS } from "../models/gtm/WatchedSource.js";

const read = (value) => readWatchedSource(value).value ?? readWatchedSource(value);

test("x.com and twitter.com are the same platform, and the handle is the identifier", () => {
	for (const url of [
		"https://x.com/acme",
		"https://twitter.com/acme",
		"https://www.x.com/acme/",
		"x.com/acme",
		"https://x.com/acme/status/1234567890",
	]) {
		assert.deepEqual({ platform: read(url).platform, identifier: read(url).identifier }, { platform: "x", identifier: "acme" }, url);
	}
});

test("a bare @handle is an X account, because that is how people write them", () => {
	const source = read("@acme");
	assert.equal(source.platform, "x");
	assert.equal(source.identifier, "acme");
	assert.equal(source.url, "https://x.com/acme");
});

test("X's own pages are not accounts", () => {
	for (const url of ["https://x.com/home", "https://x.com/search?q=saas", "https://x.com/i/lists/1"]) {
		assert.ok(readWatchedSource(url).error, url);
	}
	assert.ok(readWatchedSource("https://x.com/").error, "the site itself is not an account");
});

test("a subreddit is the identifier, however deep the link goes", () => {
	for (const url of [
		"https://reddit.com/r/saas",
		"https://www.reddit.com/r/saas/",
		"https://old.reddit.com/r/saas/comments/abc123/some_post/",
		"reddit.com/r/saas",
	]) {
		assert.equal(read(url).identifier, "r/saas", url);
		assert.equal(read(url).platform, "reddit");
	}
});

test("a Reddit user is stored as a user, not quietly as a subreddit", () => {
	assert.equal(read("https://reddit.com/user/someone").identifier, "u/someone");
	assert.equal(read("https://reddit.com/u/someone").identifier, "u/someone");
});

test("a Reddit link that is neither gets told what to paste", () => {
	assert.match(readWatchedSource("https://reddit.com/").error, /subreddit/);
	assert.match(readWatchedSource("https://reddit.com/popular").error, /subreddit/);
});

test("Hacker News is one place, so every link to it is the same source", () => {
	assert.deepEqual(
		{ ...read("https://news.ycombinator.com/") },
		{ platform: "hn", identifier: "news.ycombinator.com", url: "https://news.ycombinator.com/" }
	);
	assert.equal(read("https://news.ycombinator.com/item?id=123").identifier, "news.ycombinator.com");
	// Except a person: following one commenter is not following the whole site.
	assert.equal(read("https://news.ycombinator.com/user?id=pg").identifier, "user/pg");
});

test("anything else is kept as other rather than refused", () => {
	// A founder pasting a Discord invite should not lose it just because nothing reads Discord yet.
	const discord = read("https://discord.gg/abc123");
	assert.equal(discord.platform, "other");
	assert.equal(discord.identifier, "discord.gg/abc123");

	assert.equal(read("https://indiehackers.com/group/saas").identifier, "indiehackers.com/group/saas");
});

test("every platform it returns is one the database accepts", () => {
	for (const url of ["https://x.com/acme", "https://reddit.com/r/saas", "https://news.ycombinator.com", "https://discord.gg/x"]) {
		assert.ok(GTM_PLATFORMS.includes(read(url).platform), `${url} -> ${read(url).platform}`);
	}
});

test("what isn't a link is refused, with a reason", () => {
	for (const value of ["", "   ", "not a link", "ftp://acme.test/x", "javascript:alert(1)", "localhost:3000"]) {
		assert.ok(readWatchedSource(value).error, JSON.stringify(value));
	}
});

test("a pasted list collapses duplicates and reports what it couldn't read", () => {
	const { sources, problems } = readWatchedSources([
		"https://x.com/acme",
		"@acme",
		"https://twitter.com/acme",
		"",
		"https://reddit.com/r/saas",
		"nonsense",
	]);

	// The same account three ways is one source.
	assert.deepEqual(
		sources.map(({ platform, identifier }) => `${platform}:${identifier}`),
		["x:acme", "reddit:r/saas"]
	);
	// A blank line is not an error; "nonsense" is, and the founder is shown it rather than it vanishing.
	assert.equal(problems.length, 1);
	assert.equal(problems[0].input, "nonsense");
});

test("a list with nothing in it gives nothing, not a crash", () => {
	assert.deepEqual(readWatchedSources([]), { sources: [], problems: [] });
	assert.deepEqual(readWatchedSources(undefined), { sources: [], problems: [] });
});
