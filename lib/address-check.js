import "server-only";
import dns from "node:dns/promises";
import { ADDRESS_MESSAGES, ADDRESS_PROBLEMS, MAJOR_PROVIDERS, classifyAddress, getEmailDomain, isUndeliverableDomain } from "@/lib/address-quality";
import { connectDb } from "@/lib/db";
import BlockedDomain from "@/models/BlockedDomain";

// Is this a real, wanted address? The pure rules (typos, throwaway inboxes) plus the platform's blocklist and a
// DNS check that the domain can receive email. Used for new signups and imports; people already on a list are left alone.

const BLOCKLIST_TTL_MS = 60_000;
const DNS_TTL_MS = 6 * 60 * 60_000;
const MAX_CACHED_DOMAINS = 5000;
const DNS_TIMEOUT_MS = 3000;
const DNS_CONCURRENCY = 20;

export class AddressError extends Error {
	constructor({ reason, message, suggestion }) {
		super(message);
		this.name = "AddressError";
		this.reason = reason;
		this.suggestion = suggestion;
	}
}

let blocklist = { at: 0, domains: new Set() };
const dnsCache = new Map();
let resolver;

export function clearAddressCaches() {
	blocklist = { at: 0, domains: new Set() };
	dnsCache.clear();
}

async function getBlockedDomains() {
	if (Date.now() - blocklist.at < BLOCKLIST_TTL_MS) return blocklist.domains;
	await connectDb();
	const rows = await BlockedDomain.find().select({ domain: 1 }).lean();
	blocklist = { at: Date.now(), domains: new Set(rows.map(({ domain }) => domain)) };
	return blocklist.domains;
}

function isDnsCheckOn() {
	return String(process.env.ADDRESS_CHECK_DNS ?? "").trim().toLowerCase() !== "off";
}

function getResolver() {
	resolver ??= new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
	return resolver;
}

async function hasNoMail(domain) {
	const hit = dnsCache.get(domain);
	if (hit && hit.expiresAt > Date.now()) return hit.value;
	const value = await isUndeliverableDomain(domain, getResolver()).catch(() => false);
	if (dnsCache.size >= MAX_CACHED_DOMAINS) dnsCache.delete(dnsCache.keys().next().value);
	dnsCache.set(domain, { value, expiresAt: Date.now() + DNS_TTL_MS });
	return value;
}

// null when the address is fine, otherwise { reason, message, suggestion? }.
export async function checkAddress(email) {
	const problem = classifyAddress(email, { blocked: await getBlockedDomains() });
	if (problem) return problem;
	const domain = getEmailDomain(email);
	if (isDnsCheckOn() && !MAJOR_PROVIDERS.has(domain) && (await hasNoMail(domain))) {
		return { reason: ADDRESS_PROBLEMS.undeliverable, message: ADDRESS_MESSAGES.undeliverable };
	}
	return null;
}

export async function assertAddressOk(email) {
	const problem = await checkAddress(email);
	if (problem) throw new AddressError(problem);
}

// For an import: keeps the rows that pass and counts the rest by reason. One lookup per distinct domain.
// Rows that import someone as unsubscribed, bounced or complained are kept whatever the domain: they exist to
// stop mail going to that address.
export async function filterImportRows(rows, { isExempt = () => false } = {}) {
	const rejected = { typo: 0, disposable: 0, blocked: 0, undeliverable: 0 };
	const blocked = await getBlockedDomains();
	const verdicts = new Map();
	const domains = [...new Set(rows.filter((row) => !isExempt(row)).map(({ email }) => getEmailDomain(email)))];
	for (let start = 0; start < domains.length; start += DNS_CONCURRENCY) {
		await Promise.all(
			domains.slice(start, start + DNS_CONCURRENCY).map(async (domain) => {
				const problem = classifyAddress(`x@${domain}`, { blocked });
				if (problem) return verdicts.set(domain, problem.reason);
				if (isDnsCheckOn() && !MAJOR_PROVIDERS.has(domain) && (await hasNoMail(domain))) verdicts.set(domain, ADDRESS_PROBLEMS.undeliverable);
			})
		);
	}
	const accepted = [];
	for (const row of rows) {
		const reason = isExempt(row) ? null : verdicts.get(getEmailDomain(row.email));
		if (reason) rejected[reason]++;
		else accepted.push(row);
	}
	return { accepted, rejected, rejectedCount: Object.values(rejected).reduce((sum, count) => sum + count, 0) };
}
