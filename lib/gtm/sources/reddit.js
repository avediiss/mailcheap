import { GTM_LIMITS, isGtmRedditConfigured } from "../config.js";

// Reading the subreddits a founder watches. Where Hacker News is a search engine, Reddit is a set of
// rooms: the radar reads what was posted recently in each one and matches the keywords itself.
//
// That is a deliberate inversion of the Hacker News design, for three reasons. One request per subreddit
// per scan instead of one per keyword per subreddit, which matters against a 100-per-minute budget. No
// search relevance to fight — Hacker News taught that an engine's idea of a match and ours can differ by
// four orders of magnitude. And "matched" becomes one visible rule, the same on every platform.
//
// Reddit needs OAuth. Every unauthenticated endpoint answers 403 now, including old.reddit and plain
// listings, so there is no keyless path left.
//
// Relative imports and no "server-only": the Phase 6 command runs this under plain Node.

export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const REDDIT_API_URL = "https://oauth.reddit.com";
// Reddit asks for a descriptive agent naming the client and a contact. An anonymous one gets rate limited
// hardest, and rightly.
export const REDDIT_USER_AGENT = "NamagGtmBot/1.0 (by /u/namag; reads public posts so a founder can reply)";

let cached = null;

// Client credentials: the app reads public posts as itself, never as a person, and never writes.
export async function getRedditToken({
	env = process.env,
	fetchImpl = fetch,
	now = Date.now(),
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
} = {}) {
	if (!isGtmRedditConfigured(env)) return { error: "Reddit is not configured (REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET)" };
	// A token lasts an hour and a scan takes seconds; asking for one per subreddit would be rude.
	if (cached && cached.expiresAt > now + 60_000) return { value: cached.token };

	const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64");
	let response;
	try {
		response = await fetchImpl(REDDIT_TOKEN_URL, {
			method: "POST",
			headers: {
				Authorization: `Basic ${basic}`,
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": REDDIT_USER_AGENT,
			},
			body: "grant_type=client_credentials",
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
		return { error: isTimeout ? "Reddit didn't answer in time" : "Reddit couldn't be reached" };
	}

	if (!response.ok) {
		// A 401 here is the app's own credentials, not a person's, so say which.
		return { error: response.status === 401 ? "Reddit rejected the app credentials (401)" : `Reddit answered ${response.status}` };
	}

	let body;
	try {
		body = await response.json();
	} catch {
		return { error: "Reddit didn't answer with JSON" };
	}

	const token = String(body?.access_token ?? "").trim();
	if (!token) return { error: "Reddit returned no token" };

	cached = { token, expiresAt: now + Math.max(Number(body?.expires_in) || 3600, 60) * 1000 };
	return { value: token };
}

// For tests, and for a process whose credentials changed under it.
export function forgetRedditToken() {
	cached = null;
}

// The same rule the Hacker News search applies server-side: every word of a keyword must appear, so a
// two-word keyword is an AND and not a phrase. Doing it here keeps one visible definition of "matched"
// across platforms instead of one per search engine.
export function matchingKeywords(text, keywords = []) {
	const haystack = String(text ?? "").toLowerCase();
	return keywords.filter((keyword) => {
		const words = String(keyword ?? "")
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		return words.length > 0 && words.every((word) => haystack.includes(word));
	});
}

export function buildRedditListingUrl({ subreddit, limit = 100, after = null }) {
	const name = String(subreddit ?? "")
		.trim()
		.replace(/^\/?r\//i, "");
	const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)), raw_json: "1" });
	if (after) params.set("after", after);
	return `${REDDIT_API_URL}/r/${encodeURIComponent(name)}/new?${params}`;
}

// One post as the radar sees it, or null. The shape is the one hn.js produces, so the filter, the scorer
// and the store are unchanged by a second platform existing.
export function readRedditPost(post, { keywords = [] } = {}) {
	const data = post?.data ?? post;
	const externalId = String(data?.name ?? "").trim();
	if (!externalId) return null;

	const title = String(data?.title ?? "").trim();
	// raw_json=1 means Reddit sends real characters rather than &amp; entities.
	const body = String(data?.selftext ?? "").trim();
	const text = [title, body].filter(Boolean).join("\n\n");
	if (!text) return null;

	const seconds = Number(data?.created_utc);
	if (!Number.isFinite(seconds) || seconds <= 0) return null;

	const matched = matchingKeywords(text, keywords);
	if (keywords.length > 0 && matched.length === 0) return null;

	const permalink = String(data?.permalink ?? "").trim();
	return {
		platform: "reddit",
		externalId,
		url: permalink ? `https://www.reddit.com${permalink}` : String(data?.url ?? ""),
		author: String(data?.author ?? "").trim(),
		text,
		postedAt: new Date(seconds * 1000),
		// Its own title, like a Hacker News story: a submission is the thread, not a reply inside one.
		storyTitle: title,
		storyUrl: String(data?.url ?? "").trim(),
		keywords: matched,
	};
}

// Recent posts from one subreddit, newest first, stopping at the scan window. Paging stops at the window,
// at the cap, or when Reddit runs out — whichever comes first.
export async function readSubreddit({
	subreddit,
	keywords = [],
	since = null,
	token,
	limit = GTM_LIMITS.maxRedditPostsPerSubreddit,
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
}) {
	const candidates = [];
	let after = null;
	let read = 0;

	while (read < limit) {
		const url = buildRedditListingUrl({ subreddit, limit: Math.min(limit - read, 100), after });

		let response;
		try {
			response = await fetchImpl(url, {
				headers: { Authorization: `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT, Accept: "application/json" },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
			return { error: isTimeout ? `r/${subreddit} didn't answer in time` : `r/${subreddit} couldn't be reached` };
		}

		if (response.status === 429) return { error: `Reddit is rate-limiting us on r/${subreddit} (429)` };
		if (!response.ok) return { error: `r/${subreddit} answered ${response.status}` };

		let body;
		try {
			body = await response.json();
		} catch {
			return { error: `r/${subreddit} didn't answer with JSON` };
		}

		const children = Array.isArray(body?.data?.children) ? body.data.children : [];
		if (children.length === 0) break;
		read += children.length;

		let reachedWindow = false;
		for (const child of children) {
			// The listing is newest first, so the first post older than the window ends the subreddit:
			// everything after it is older still.
			const postedAt = Number(child?.data?.created_utc) * 1000;
			if (since && Number.isFinite(postedAt) && postedAt < new Date(since).getTime()) {
				reachedWindow = true;
				break;
			}
			const candidate = readRedditPost(child, { keywords });
			if (candidate) candidates.push(candidate);
		}

		after = body?.data?.after ?? null;
		if (reachedWindow || !after) break;
	}

	return { candidates };
}

// Every watched subreddit. One failing is not the scan failing.
export async function searchReddit({
	subreddits = [],
	keywords = [],
	since = null,
	env = process.env,
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
	limitPerSubreddit = GTM_LIMITS.maxRedditPostsPerSubreddit,
}) {
	if (subreddits.length === 0 || keywords.length === 0) return { candidates: [], problems: [] };

	const auth = await getRedditToken({ env, fetchImpl, timeoutMs });
	// No credentials is not a failure worth retrying or alarming anyone about: Reddit is simply off.
	if (auth.error) return { candidates: [], problems: [{ subreddit: "*", error: auth.error }] };

	const found = new Map();
	const problems = [];

	for (const subreddit of subreddits) {
		const result = await readSubreddit({
			subreddit,
			keywords,
			since,
			token: auth.value,
			limit: limitPerSubreddit,
			fetchImpl,
			timeoutMs,
		});
		if (result.error) {
			problems.push({ subreddit, error: result.error });
			continue;
		}
		// One post belongs to one subreddit, but a founder may have the same room on the list twice.
		for (const candidate of result.candidates) found.set(candidate.externalId, candidate);
	}

	const candidates = [...found.values()].sort((a, b) => b.postedAt - a.postedAt);
	return { candidates, problems };
}
