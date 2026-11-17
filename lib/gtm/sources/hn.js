import { GTM_LIMITS } from "../config.js";
import { htmlToText } from "../html-text.js";

// Searching Hacker News for people describing the problem a product solves. The first platform the radar
// reads, chosen because its search needs no key, no account and no quota negotiation: the whole loop can be
// proved for nothing before anyone pays X for the privilege.
//
// Relative imports and no "server-only": scripts/ runs this under plain Node, like site-reader.js.

export const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
export const HN_ITEM_URL = "https://news.ycombinator.com/item";

// Algolia's defaults are built for a search box, where showing something beats showing nothing, and the
// cost of that is carried by whoever reads the results. Typo tolerance is the whole problem: measured over
// ninety days of comments, "ga4" matches 57,555 of them loosely and 12 with it switched off. Quoting the
// keyword as a phrase goes too far the other way — four of five real keywords then match nothing at all,
// because people write "an alternative to Google Analytics", not the phrase in the order we guessed.
//
// So: every word must appear, anywhere in the comment, spelled correctly. Measured over the same ninety
// days, that turns 0 / 12 / 2 / 0 / 0 hits into 5 / 12 / 4 / 34 / 8 — few enough to afford scoring, many
// enough to be worth running.
function buildParams({ keyword, since, tags, hitsPerPage, page }) {
	const params = new URLSearchParams({
		// Quotes would make this a phrase search, which finds almost nothing; stripped rather than
		// escaped, since a keyword is a handful of words, never a query language.
		query: String(keyword).replaceAll('"', " ").replace(/\s+/g, " ").trim(),
		typoTolerance: "false",
		// A comment that matched only because its story's title has the keyword is not someone talking
		// about the problem; it is someone replying under a headline. A story is its own headline, so
		// there the title is exactly the thing to match.
		restrictSearchableAttributes: tags === "story" ? "title,story_text" : "comment_text",
		tags,
		hitsPerPage: String(hitsPerPage),
		page: String(page),
	});
	if (since) {
		// The scan asks only for what is new since it last looked. Algolia counts in whole seconds.
		params.set("numericFilters", `created_at_i>${Math.floor(since.getTime() / 1000)}`);
	}
	return params;
}

export function buildHnSearchUrl({ keyword, since = null, tags = "comment", hitsPerPage = 50, page = 0 }) {
	return `${HN_SEARCH_URL}?${buildParams({ keyword, since, tags, hitsPerPage, page })}`;
}

// One hit as the radar sees it, or null when it is not usable. The shape is deliberately platform-neutral:
// Reddit and X have to produce the same thing, and only this file should ever know what Algolia calls its
// fields.
export function readHnHit(hit, { keyword = "" } = {}) {
	const externalId = String(hit?.objectID ?? "").trim();
	if (!externalId) return null;

	// Comment text arrives as escaped HTML — <p> between paragraphs, &gt; for a quote, &#x2F; for a slash.
	// A story has no comment_text: its words are its title and, for an Ask HN, the body under it. Both
	// kinds matter, and they are different genres — a comment is someone discussing, a story is often
	// someone asking.
	const title = String(hit?.title ?? "").trim();
	const text = hit?.comment_text
		? htmlToText(hit.comment_text)
		: [title, htmlToText(hit?.story_text ?? "")].filter(Boolean).join("\n\n");
	if (!text) return null;

	const seconds = Number(hit?.created_at_i);
	// A hit with no usable timestamp can still be read, but it cannot be placed in time, and the scan
	// window is the whole point. Drop it rather than guess at "now".
	if (!Number.isFinite(seconds) || seconds <= 0) return null;

	return {
		platform: "hn",
		externalId,
		url: `${HN_ITEM_URL}?id=${encodeURIComponent(externalId)}`,
		author: String(hit?.author ?? "").trim(),
		text,
		postedAt: new Date(seconds * 1000),
		// Context for the scorer and for the founder: a comment is an answer to something. A story is its
		// own context, and giving it its title here keeps the megathread filter working on both kinds.
		storyTitle: String(hit?.story_title ?? "").trim() || title,
		storyUrl: String(hit?.story_url ?? hit?.url ?? "").trim(),
		keyword,
	};
}

// One keyword, newest first, up to a limit. Paging stops at the limit, at the last page, or at the first
// page that returns nothing — whichever comes first.
export async function searchHnKeyword({
	keyword,
	since = null,
	limit = GTM_LIMITS.maxCandidatesPerKeyword,
	tags = "comment",
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
}) {
	const wanted = String(keyword ?? "").trim();
	if (!wanted) return { error: "the keyword is empty" };

	const candidates = [];
	const hitsPerPage = Math.min(Math.max(limit, 1), 50);

	for (let page = 0; candidates.length < limit; page += 1) {
		const url = buildHnSearchUrl({ keyword: wanted, since, tags, hitsPerPage, page });

		let response;
		try {
			response = await fetchImpl(url, {
				signal: AbortSignal.timeout(timeoutMs),
				headers: { Accept: "application/json", "User-Agent": "NamagGtmBot/1.0" },
			});
		} catch (error) {
			const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";
			const seconds = Math.round(timeoutMs / 1000);
			return { error: isTimeout ? `Hacker News didn't answer within ${seconds} seconds` : "Hacker News couldn't be reached" };
		}

		if (!response.ok) return { error: `Hacker News search answered ${response.status}` };

		let body;
		try {
			body = await response.json();
		} catch {
			return { error: "Hacker News search didn't answer with JSON" };
		}

		const hits = Array.isArray(body?.hits) ? body.hits : [];
		for (const hit of hits) {
			const candidate = readHnHit(hit, { keyword: wanted });
			if (candidate) candidates.push(candidate);
			if (candidates.length >= limit) break;
		}

		// Out of pages, or the page was empty: asking again would only repeat it.
		const pages = Number(body?.nbPages);
		if (hits.length === 0 || !Number.isFinite(pages) || page + 1 >= pages) break;
	}

	return { candidates };
}

// Every keyword in the profile, de-duplicated. One post can match several keywords; it is kept once, with
// every keyword that found it, because "three of your keywords are in this post" is worth knowing when it
// comes to be scored.
// Both kinds, because they are different genres. A comment is usually someone discussing a topic; a story
// — an Ask HN, a Tell HN — is often someone asking for a recommendation or complaining about a tool they
// use, which is the genre worth replying to. Searching only comments quietly excludes it.
export async function searchHn({
	keywords,
	since = null,
	limitPerKeyword = GTM_LIMITS.maxCandidatesPerKeyword,
	tagsToSearch = ["comment", "story"],
	fetchImpl = fetch,
	timeoutMs = GTM_LIMITS.searchTimeoutMs,
}) {
	const wanted = (Array.isArray(keywords) ? keywords : []).map((keyword) => String(keyword ?? "").trim()).filter(Boolean);
	if (wanted.length === 0) return { candidates: [], problems: [] };

	const found = new Map();
	const problems = [];

	// One keyword at a time, on purpose. The radar runs on a schedule with nobody waiting on it, and a
	// polite sequence of requests is a better neighbour than a burst against a free service.
	for (const keyword of wanted) {
		for (const tags of tagsToSearch) {
			const result = await searchHnKeyword({ keyword, since, limit: limitPerKeyword, tags, fetchImpl, timeoutMs });
			// One keyword failing is not the scan failing: the others still have something to say.
			if (result.error) {
				problems.push({ keyword, tags, error: result.error });
				continue;
			}

			for (const candidate of result.candidates) {
				const seen = found.get(candidate.externalId);
				if (seen) {
					if (!seen.keywords.includes(keyword)) seen.keywords.push(keyword);
					continue;
				}
				const { keyword: matched, ...rest } = candidate;
				found.set(candidate.externalId, { ...rest, keywords: [matched] });
			}
		}
	}

	// Newest first, which is also the order a founder would want to reply in.
	const candidates = [...found.values()].sort((a, b) => b.postedAt - a.postedAt);
	return { candidates, problems };
}
