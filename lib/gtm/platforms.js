// What a pasted link is, and the identifier the radar will query. x.com and twitter.com are the same
// platform; reddit.com/r/<name> is a community; news.ycombinator.com is one site. Anything else is kept as
// "other" rather than refused: a founder pasting a Discord invite should not lose it.
//
// No imports on purpose: this is pure URL parsing, so it stays out of Mongoose and out of Next. The
// platform names it returns are the enum in models/gtm/WatchedSource.js, and a test holds the two to
// each other rather than one importing the other.

// Handles that are the site's own pages, not someone's account.
const X_RESERVED = new Set([
	"home", "explore", "notifications", "messages", "search", "settings", "i", "intent", "share",
	"compose", "login", "logout", "signup", "about", "tos", "privacy", "hashtag",
]);

function stripAt(value) {
	return value.replace(/^@+/, "");
}

// x.com/acme, x.com/acme/status/123 and @acme all identify the same account.
function readX(url) {
	const [first] = url.pathname.split("/").filter(Boolean);
	if (!first) return { error: "That link doesn't point at an account" };

	const handle = stripAt(first);
	if (X_RESERVED.has(handle.toLowerCase())) return { error: "That's a page on X, not an account" };
	if (!/^\w{1,15}$/.test(handle)) return { error: "That doesn't look like an X account" };
	return { platform: "x", identifier: handle };
}

// reddit.com/r/saas — the subreddit, however deep the link goes. A user page is an account, not a community,
// so it is stored as the user rather than silently treated as a subreddit.
function readReddit(url) {
	const parts = url.pathname.split("/").filter(Boolean);
	const kind = parts[0]?.toLowerCase();
	const name = parts[1];

	if ((kind === "r" || kind === "user" || kind === "u") && name) {
		if (!/^\w{2,30}$/.test(name)) return { error: "That doesn't look like a subreddit" };
		return { platform: "reddit", identifier: kind === "r" ? `r/${name}` : `u/${name}` };
	}
	return { error: "Link to a subreddit, like reddit.com/r/saas" };
}

// Hacker News has no per-community URL: a link to the site, a user or a thread is all the one place.
function readHackerNews(url) {
	const user = url.searchParams.get("id");
	if (url.pathname.replace(/\/$/, "").endsWith("/user") && user) return { platform: "hn", identifier: `user/${user}` };
	return { platform: "hn", identifier: "news.ycombinator.com" };
}

const HOSTS = [
	{ match: (host) => host === "x.com" || host === "twitter.com", read: readX },
	{ match: (host) => host === "reddit.com" || host.endsWith(".reddit.com"), read: readReddit },
	{ match: (host) => host === "news.ycombinator.com", read: readHackerNews },
];

// A pasted link, or why it can't be used. An unrecognised but valid site is "other": its identifier is its
// host plus path, which is enough to show the founder what they added.
export function readWatchedSource(value) {
	const raw = String(value ?? "").trim();
	if (!raw) return { error: "Paste a link first" };

	// A bare @handle is an X account; that is how people write them.
	if (/^@\w{1,15}$/.test(raw)) {
		return { value: { platform: "x", identifier: stripAt(raw), url: `https://x.com/${stripAt(raw)}` } };
	}

	const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	let url;
	try {
		url = new URL(withProtocol);
	} catch {
		return { error: "That doesn't look like a link" };
	}
	if (!["http:", "https:"].includes(url.protocol)) return { error: "The link has to start with http:// or https://" };
	if (!url.hostname.includes(".")) return { error: "That doesn't look like a link" };

	// www. and a trailing slash are noise; m.reddit.com is the same site as reddit.com.
	const host = url.hostname.toLowerCase().replace(/^(?:www|m|old|mobile)\./, "");
	const handler = HOSTS.find(({ match }) => match(host));

	if (handler) {
		const read = handler.read(url);
		if (read.error) return { error: read.error };
		return { value: { platform: read.platform, identifier: read.identifier, url: url.href } };
	}

	const path = url.pathname.replace(/\/$/, "");
	return { value: { platform: "other", identifier: `${host}${path}`.slice(0, 200), url: url.href } };
}

// A list of pasted links: what was understood, and what wasn't, with the duplicates collapsed. The founder
// sees both — a link silently dropped is worse than one shown as rejected.
export function readWatchedSources(values) {
	const sources = [];
	const problems = [];
	const seen = new Set();

	for (const value of Array.isArray(values) ? values : []) {
		const raw = String(value ?? "").trim();
		if (!raw) continue;

		const read = readWatchedSource(raw);
		if (read.error) {
			problems.push({ input: raw, error: read.error });
			continue;
		}
		const key = `${read.value.platform}:${read.value.identifier.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		sources.push(read.value);
	}

	return { sources, problems };
}
