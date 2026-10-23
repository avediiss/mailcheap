import { DISPOSABLE_DOMAINS } from "./data/disposable-domains.js";

// Pure rules for telling a real address from a typo, a throwaway inbox or a blocked domain. Signups and imports
// use them (lib/address-check.js adds the blocklist and the "can this domain receive email" lookup).

export function getEmailDomain(email) {
	const at = String(email ?? "").lastIndexOf("@");
	return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

// Big mailbox providers: never looked up and never blocked, and the typos below are measured against them.
export const MAJOR_PROVIDERS = new Set([
	"gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
	"icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.de", "web.de",
	"yandex.com", "yandex.ru", "mail.ru", "zoho.com", "fastmail.com", "hey.com", "qq.com", "163.com", "126.com",
]);

// Domains people mistype, and what they meant.
const KNOWN_TYPOS = {
	"gmial.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmal.com": "gmail.com",
	"gmaill.com": "gmail.com", "gmil.com": "gmail.com", "gmsil.com": "gmail.com", "gmaul.com": "gmail.com", "gmail.co": "gmail.com",
	"gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmail.comm": "gmail.com", "gmailc.om": "gmail.com",
	"gmail.vom": "gmail.com", "gmail.clm": "gmail.com", "gmeil.com": "gmail.com", "gmaip.com": "gmail.com", "g-mail.com": "gmail.com",
	"hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotnail.com": "hotmail.com",
	"hotmaill.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmail.con": "hotmail.com", "hotmail.cm": "hotmail.com",
	"yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahho.com": "yahoo.com", "yahoo.con": "yahoo.com",
	"yahoo.cm": "yahoo.com", "yahoo.comm": "yahoo.com", "yaoo.com": "yahoo.com",
	"outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.con": "outlook.com", "outlook.cm": "outlook.com", "outllok.com": "outlook.com",
	"iclod.com": "icloud.com", "icoud.com": "icloud.com", "icloud.con": "icloud.com", "icloud.co": "icloud.com", "iclould.com": "icloud.com",
	"aol.con": "aol.com", "protonmail.con": "protonmail.com", "protonmail.co": "protonmail.com",
};

const PROVIDER_LABELS = ["gmail", "yahoo", "hotmail", "outlook", "icloud"];
// One letter away from these is a different, real company.
const REAL_LABELS = new Set(["mail", "email", "gmx", "yahoo", "gmail"]);

// Whether two short strings differ by one insertion, deletion, substitution or swap of neighbours.
function isOneEditAway(a, b) {
	if (a === b) return false;
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (a.length === b.length) {
		if (a.slice(i + 1) === b.slice(i + 1)) return true;
		return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
	}
	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	return shorter.slice(i) === longer.slice(i + 1);
}

// "gmail.com" when the domain is a likely typo of a big provider, else null.
export function findTypoSuggestion(domain) {
	const value = String(domain ?? "").toLowerCase();
	if (MAJOR_PROVIDERS.has(value)) return null;
	if (KNOWN_TYPOS[value]) return KNOWN_TYPOS[value];
	const match = /^([a-z]{4,10})\.com$/.exec(value);
	if (!match || REAL_LABELS.has(match[1])) return null;
	const label = PROVIDER_LABELS.find((provider) => isOneEditAway(match[1], provider));
	return label ? `${label}.com` : null;
}

// The domain, or any domain above it, is on the list (mailinator.com, and sub.mailinator.com).
function matchesList(domain, list) {
	const parts = domain.split(".");
	for (let index = 0; index <= parts.length - 2; index++) {
		if (list.has(parts.slice(index).join("."))) return true;
	}
	return false;
}

export const isDisposableDomain = (domain) => matchesList(String(domain ?? "").toLowerCase(), DISPOSABLE_DOMAINS);
export const isBlockedDomain = (domain, blocked) => matchesList(String(domain ?? "").toLowerCase(), blocked ?? new Set());

export const ADDRESS_PROBLEMS = {
	typo: "typo",
	disposable: "disposable",
	blocked: "blocked",
	undeliverable: "undeliverable",
};

// The problem with an address that needs no lookup, or null. `blocked` is a Set of domains the platform refuses.
export function classifyAddress(email, { blocked } = {}) {
	const domain = getEmailDomain(email);
	if (!domain) return { reason: ADDRESS_PROBLEMS.undeliverable, message: ADDRESS_MESSAGES.undeliverable };
	if (MAJOR_PROVIDERS.has(domain)) return null;
	const suggestion = findTypoSuggestion(domain);
	if (suggestion) return { reason: ADDRESS_PROBLEMS.typo, suggestion, message: `That looks like a typo. Did you mean ${email.slice(0, email.lastIndexOf("@"))}@${suggestion}?` };
	if (isBlockedDomain(domain, blocked)) return { reason: ADDRESS_PROBLEMS.blocked, message: ADDRESS_MESSAGES.blocked };
	if (isDisposableDomain(domain)) return { reason: ADDRESS_PROBLEMS.disposable, message: ADDRESS_MESSAGES.disposable };
	return null;
}

export const ADDRESS_MESSAGES = {
	disposable: "Temporary email addresses aren't accepted. Please use your regular address.",
	blocked: "This email domain isn't accepted. Please use a different address.",
	undeliverable: "That email domain can't receive email. Please check the address.",
};

// A DNS error that means "this domain doesn't exist or has no mail setup", as opposed to "the lookup failed".
const NO_SUCH_DOMAIN_CODES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

// resolver: { resolveMx, resolve4, resolve6 } like node:dns/promises. A domain with no MX still receives mail
// at its own address record, so it only counts as undeliverable when it has neither. Any other failure (timeout,
// server error) says nothing about the domain, so it is allowed through.
export async function isUndeliverableDomain(domain, resolver) {
	try {
		const records = await resolver.resolveMx(domain);
		if (records.some(({ exchange }) => exchange && exchange !== ".")) return false;
		// "Null MX" (a single "."): the domain says it takes no email at all.
		if (records.length > 0) return true;
	} catch (error) {
		if (!NO_SUCH_DOMAIN_CODES.has(error?.code)) return false;
	}
	for (const lookup of [resolver.resolve4, resolver.resolve6]) {
		try {
			if ((await lookup.call(resolver, domain)).length > 0) return false;
		} catch (error) {
			if (!NO_SUCH_DOMAIN_CODES.has(error?.code)) return false;
		}
	}
	return true;
}
