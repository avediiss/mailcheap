// Pure rules for the sending domains a workspace adds.

// Nobody can prove they own these, and SES would never verify them.
const PUBLIC_MAIL_DOMAINS = new Set([
	"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
	"icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.com",
	"yandex.com", "zoho.com", "fastmail.com", "hey.com",
]);
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// "  https://News.Example.com/path " -> "news.example.com". null when it isn't a domain name.
export function normalizeDomain(input) {
	let value = String(input ?? "").trim().toLowerCase();
	if (!value) return null;
	value = value.replace(/^[a-z]+:\/\//, "").replace(/^[^@/]*@/, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
	return value || null;
}

// null when fine, else the sentence to show.
export function getDomainProblem(domain) {
	if (!domain) return "Enter a domain, like example.com";
	if (domain.length > 253) return "That domain is too long";
	const labels = domain.split(".");
	if (labels.length < 2) return "Enter a full domain, like example.com";
	if (!labels.every((label) => LABEL_PATTERN.test(label))) return "That doesn't look like a domain name";
	if (/^\d+$/.test(labels.at(-1))) return "Use a domain name, not an IP address";
	if (PUBLIC_MAIL_DOMAINS.has(domain)) return `${domain} is a public email service. Use a domain you own.`;
	return null;
}

// Two workspaces can't both send from the same domain, or from a domain and its parent or child: whoever
// holds example.com may send from news.example.com. Returns the domain in the way, or null.
export function findDomainConflict(domain, othersDomains) {
	for (const other of othersDomains ?? []) {
		if (other === domain || domain.endsWith(`.${other}`) || other.endsWith(`.${domain}`)) return other;
	}
	return null;
}

export function describeDomainStatus({ ses }) {
	if (!ses) return { key: "missing", label: "Not set up", hint: "This domain isn't in the sending service yet." };
	if (ses.verified) return { key: "verified", label: "Verified", hint: "Ready to send." };
	return { key: "pending", label: "Pending", hint: "Add the DNS records below, then check again. It can take a few minutes to a few hours." };
}
