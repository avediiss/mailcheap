import { GTM_LIMITS } from "../config.js";
import { matchingKeywords } from "./match.js";

// Searching Bluesky for people describing the problem a product solves. The third platform, and the first
// that produced a real opportunity: measured over thirty days for a privacy-analytics product, 260 posts
// matched its keywords and three scored above 60, one of them a person asking outright for an alternative
// to Google Analytics. Hacker News gave none in ninety days.
//
// No key and no account. Two things the documentation does not say, both measured:
// - public.api.bsky.app, the host Bluesky documents as the public one, refuses search with a 403.
//   api.bsky.app answers it without authentication. If that changes, an app password and a session are
//   the fallback; Bluesky gives those to any account, without the approval Reddit now requires.
// - Unauthenticated paging is cut off: a later page sometimes answers 403 where the first answered 200.
//   That is the end of what can be read, not a failure, so it ends the keyword and keeps what was found.
//
// Relative imports and no "server-only": scripts/ runs this under plain Node.

export const BLUESKY_SEARCH_URL = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts";

export function buildBlueskySearchUrl({ keyword, since = null, limit = 100, cursor = null }) {
	const params = new URLSearchParams({
		q: String(keyword ?? "").trim(),
		sort: "latest",
		limit: String(Math.min(Math.max(limit, 1), 100)),
	});
	if (since) params.set("since", new Date(since).toISOString());
	if (cursor) params.set("cursor", cursor);
	return `${BLUESKY_SEARCH_URL}?${params}`;
}

// One post as the radar sees it, or null. Bluesky's own matching is looser than ours — about a quarter of
// what it returns is missing a word — so every post is held to match.js before it is a candidate.
export function readBlueskyPost(post, { keywords = [] } = {}) {
	const uri = String(post?.uri ?? "").trim();
	if (!uri) return null;

	const text = String(post?.record?.text ?? "").trim();
	if (!text) return null;

	const matched = matchingKeywords(text, keywords);
	if (keywords.length > 0 && matched.length === 0) return null;

	// createdAt is set by the client that posted and can be anything; indexedAt is when Bluesky saw it.
	const created = new Date(post?.record?.createdAt ?? "");
	const indexed = new Date(post?.indexedAt ?? "");
	const postedAt = Number.isFinite(created.getTime()) ? created : indexed;
	if (!Number.isFinite(postedAt.getTime())) return null;

	const handle = String(post?.author?.handle ?? "").trim();
	const rkey = uri.split("/").at(-1);
	return {
		platform: "bluesky",
		externalId: uri,
		url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : uri,
		author: handle,
		text,
		postedAt,
		// A Bluesky post sits under nothing the search returns; a reply's parent would cost another call.
		storyTitle: "",
		storyUrl: "",
		keywords: matched,
	};
}

export async function searchBlueskyKeyword({
	keyword,
	keywords = [keyword],
	since = null,
	limit = GTM_LIMITS.maxCandidatesPerKeyword,
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
}) {
	const wanted = String(keyword ?? "").trim();
	if (!wanted) return { error: "the keyword is empty" };

	const candidates = [];
	let cursor = null;

	for (let page = 0; candidates.length < limit; page += 1) {
		let response;
		try {
			response = await fetchImpl(buildBlueskySearchUrl({ keyword: wanted, since, cursor }), {
				headers: { Accept: "application/json", "User-Agent": "NamagGtmBot/1.0" },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
			const seconds = Math.round(timeoutMs / 1000);
			return { error: isTimeout ? `Bluesky didn't answer within ${seconds} seconds` : "Bluesky couldn't be reached" };
		}

		// Measured: unauthenticated paging is refused partway. What came before still counts.
		if (response.status === 403 && page > 0) break;
		if (response.status === 429) return { error: "Bluesky is rate-limiting us (429)" };
		if (!response.ok) return { error: `Bluesky search answered ${response.status}` };

		let body;
		try {
			body = await response.json();
		} catch {
			return { error: "Bluesky search didn't answer with JSON" };
		}

		const posts = Array.isArray(body?.posts) ? body.posts : [];
		for (const post of posts) {
			const candidate = readBlueskyPost(post, { keywords });
			if (candidate) candidates.push(candidate);
			if (candidates.length >= limit) break;
		}

		cursor = body?.cursor ?? null;
		if (posts.length === 0 || !cursor) break;
	}

	return { candidates };
}

// Every keyword, de-duplicated. A post one keyword found is checked against all of them, so it carries
// every keyword it actually contains — the same thing the other platforms report.
export async function searchBluesky({
	keywords,
	since = null,
	limitPerKeyword = GTM_LIMITS.maxCandidatesPerKeyword,
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
}) {
	const wanted = (Array.isArray(keywords) ? keywords : []).map((keyword) => String(keyword ?? "").trim()).filter(Boolean);
	if (wanted.length === 0) return { candidates: [], problems: [] };

	const found = new Map();
	const problems = [];

	for (const keyword of wanted) {
		const result = await searchBlueskyKeyword({ keyword, keywords: wanted, since, limit: limitPerKeyword, fetchImpl, timeoutMs });
		if (result.error) {
			problems.push({ keyword, error: result.error });
			continue;
		}
		for (const candidate of result.candidates) {
			if (!found.has(candidate.externalId)) found.set(candidate.externalId, candidate);
		}
	}

	const candidates = [...found.values()].sort((a, b) => b.postedAt - a.postedAt);
	return { candidates, problems };
}
