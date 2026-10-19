import { getAppUrl } from "./config.js";

// ARCHIVE_HOSTS="news.example.com=weekly,letters.example.org=another" serves a newsletter's archive
// on its own domain: / lists the issues, /p/slug shows one.
export function parseArchiveHosts(value) {
	const hosts = new Map();
	for (const pair of String(value ?? "").split(",")) {
		const [host, slug] = pair.split("=").map((part) => part?.trim().toLowerCase());
		if (host && slug) hosts.set(host, slug);
	}
	return hosts;
}

export function getArchiveSlugForHost(host, value = process.env.ARCHIVE_HOSTS) {
	const hostname = String(host ?? "")
		.toLowerCase()
		.split(":")[0];
	return parseArchiveHosts(value).get(hostname) ?? null;
}

// The newsletter's own setting first (archiveHost), then the ARCHIVE_HOSTS environment variable.
export function getArchiveHost(slug, value = process.env.ARCHIVE_HOSTS, archiveHost = null) {
	if (archiveHost) return archiveHost;
	for (const [host, hostSlug] of parseArchiveHosts(value)) if (hostSlug === slug) return host;
	return null;
}

const ARCHIVE_PATH_PATTERN = /^\/archive\/([^/]+)(\/.*)?$/;
const HOST_PATHS = { "/sitemap": "/sitemap.xml", "/robots": "/robots.txt" };

// Where an app-domain /archive path lives on the newsletter's own domain, or null without one.
export function getArchiveHostUrl(pathname, search = "", value = process.env.ARCHIVE_HOSTS) {
	const match = ARCHIVE_PATH_PATTERN.exec(pathname);
	const host = match && getArchiveHost(match[1], value);
	return host ? buildArchiveHostUrl(host, match[2], search) : null;
}

export function getArchiveSlugFromPath(pathname) {
	return ARCHIVE_PATH_PATTERN.exec(pathname)?.[1] ?? null;
}

export function buildArchiveHostUrl(host, path, search = "") {
	const subpath = path ?? "/";
	return `https://${host}${HOST_PATHS[subpath] ?? subpath}${search}`;
}

// Archive pages are cached once for every host, so their links can't depend on the request. Without
// a domain of its own, the archive lives at APP_URL/archive/<slug>.
export function getArchiveUrls({ slug, archiveHost }, value = process.env.ARCHIVE_HOSTS, appUrl = getAppUrl()) {
	const host = getArchiveHost(slug, value, archiveHost);
	const base = host ? `https://${host}` : `/archive/${slug}`;
	const absoluteBase = host ? base : `${appUrl}${base}`;
	return {
		host,
		index: host ? `${base}/` : base,
		post: (postSlug) => `${base}/p/${postSlug}`,
		author: (authorSlug) => `${base}/authors/${authorSlug}`,
		siteIndex: host ? `${base}/` : absoluteBase,
		absolutePost: (postSlug) => `${absoluteBase}/p/${postSlug}`,
		absoluteAuthor: (authorSlug) => `${absoluteBase}/authors/${authorSlug}`,
	};
}

// null when this can be a newsletter's archive domain, else the sentence to show. appHost is the dashboard's
// own host, which an archive can never take over.
export function getArchiveHostProblem(input, appHost) {
	if (!input) return null;
	const host = String(input).trim().toLowerCase();
	const labels = host.split(".");
	if (host.length > 253 || labels.length < 2 || !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
		return "Enter a domain name like news.example.com";
	}
	if (/^\d+$/.test(labels.at(-1))) return "Use a domain name, not an IP address";
	if (appHost && (host === String(appHost).toLowerCase())) return "This is the dashboard's own address. Pick a different domain.";
	return null;
}
