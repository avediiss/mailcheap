import "server-only";
import { getArchiveSlugForHost, getArchiveHost } from "@/lib/archive-hosts";
import { getAppUrl } from "@/lib/config";
import { connectDb } from "@/lib/db";
import Newsletter from "@/models/Newsletter";
import Workspace from "@/models/Workspace";

// The proxy asks on every request to a host that isn't the dashboard, so answers are kept for a minute
// (found or not found): a newsletter's new domain starts working within that, and a flood of requests to a
// random host costs one query a minute, not one each.
const TTL_MS = 60_000;
const MAX_ENTRIES = 500;
const hostCache = new Map();
const slugCache = new Map();

function remember(cache, key, value) {
	if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
	cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
	return value;
}

function recall(cache, key) {
	const hit = cache.get(key);
	return hit && hit.expiresAt > Date.now() ? hit : null;
}

export function isDashboardHost(host, appUrl = getAppUrl()) {
	const hostname = String(host ?? "").toLowerCase().split(":")[0];
	if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return true;
	try {
		return hostname === new URL(appUrl).hostname.toLowerCase();
	} catch {
		return false;
	}
}

// Which newsletter's archive this host serves: the environment variable first, then the newsletters' own
// archiveHost setting. A newsletter in a suspended workspace serves nothing.
export async function resolveArchiveSlug(host) {
	const fromEnv = getArchiveSlugForHost(host);
	if (fromEnv) return fromEnv;
	if (isDashboardHost(host)) return null;
	const hostname = String(host).toLowerCase().split(":")[0];
	const hit = recall(hostCache, hostname);
	if (hit) return hit.value;

	await connectDb();
	const newsletter = await Newsletter.findOne({ archiveHost: hostname, archiveEnabled: true }).select({ slug: 1, workspaceId: 1 }).lean();
	const isActive = newsletter && (await Workspace.exists({ _id: newsletter.workspaceId, status: "active" }));
	return remember(hostCache, hostname, isActive ? newsletter.slug : null);
}

// The domain a newsletter's archive lives on, for sending app-domain /archive/<slug> visitors there.
export async function resolveArchiveHostForSlug(slug) {
	const fromEnv = getArchiveHost(slug);
	if (fromEnv) return fromEnv;
	const hit = recall(slugCache, slug);
	if (hit) return hit.value;

	await connectDb();
	const newsletter = await Newsletter.findOne({ slug, archiveEnabled: true }).select({ archiveHost: 1 }).lean();
	return remember(slugCache, slug, newsletter?.archiveHost ?? null);
}

export function clearArchiveHostCache() {
	hostCache.clear();
	slugCache.clear();
}
