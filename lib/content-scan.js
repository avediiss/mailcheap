// A quick automatic look at what is about to be sent, for the two things that hurt everyone on a shared sending
// account: emails that are phishing, scams or malware (strong signals: the issue waits for a person at the
// platform to look at it), and wording that spam filters dislike (tips: shown, never blocking). It reads text and
// links only, and a rule that fires says why in plain words.

const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "rb.gy"]);
const EXECUTABLE_EXTENSIONS = /\.(exe|scr|bat|cmd|msi|apk|vbs|jar|ps1)(?:[?#]|$)/i;
const SPAM_PHRASES = [
	"100% free", "act now", "limited time", "click here", "risk free", "no obligation", "make money fast", "earn extra cash",
	"guaranteed", "you're a winner", "congratulations", "cash bonus", "buy now", "order now", "double your", "no credit check", "once in a lifetime",
];

const CREDENTIAL_PATTERNS = [
	/\b(?:your|the) account (?:has been|is|will be|was) (?:suspended|locked|limited|closed|disabled|deactivated|compromised)/i,
	/\b(?:verify|confirm|validate|update|re-?enter) (?:your |the )?(?:password|login details|credentials|bank (?:account|details)|billing (?:information|details)|payment (?:information|details|method)|credit card|card (?:number|details)|identity|social security)/i,
	/\b(?:enter|provide|send|reply with) (?:us )?(?:your )?(?:password|pin code|credit card|card number|social security number|ssn|bank account number)/i,
	/\bunusual (?:sign-?in|login|activity) (?:was )?detected/i,
];
const CRYPTO_PATTERN = /\b(?:seed phrase|recovery phrase|secret phrase|private key)\b|\bdouble your (?:bitcoin|btc|crypto|eth)|\bsend \S+ ?(?:btc|bitcoin|eth|usdt)\b|\bconnect (?:your )?wallet\b/i;
const PRIZE_PATTERN = /\b(?:you(?:'ve| have) won|lottery winner|claim your prize|unclaimed (?:funds|inheritance)|inheritance of)\b/i;
const FEE_PATTERN = /\b(?:processing fee|transfer fee|western union|moneygram|gift cards?)\b/i;
const GIFT_CARD_PATTERN = /\bbuy (?:me )?(?:\d+ )?(?:itunes|apple|google play|amazon|steam|target) gift cards?\b/i;

function decodeEntities(text) {
	return text.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");
}

export function toPlainText(body) {
	return decodeEntities(String(body ?? "").replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Every link in an HTML or Markdown body, with the text a reader sees for it.
export function extractLinks(body) {
	const text = String(body ?? "");
	const links = [];
	for (const match of text.matchAll(/<a\s[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
		links.push({ href: decodeEntities(match[2]).trim(), text: toPlainText(match[3]) });
	}
	for (const match of text.matchAll(/\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g)) links.push({ href: match[2], text: match[1].trim() });
	return links;
}

function hostOf(href) {
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`);
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

// A link whose visible text is itself an address (paypal.com/login) but that goes somewhere else.
function isMismatched({ href, text }) {
	if (!/^https?:\/\//i.test(href)) return false;
	const shown = text.replace(/^https?:\/\//i, "").trim();
	if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#]\S*)?$/i.test(shown)) return false;
	const target = hostOf(href);
	const shownHost = hostOf(shown);
	if (!target || !shownHost) return false;
	return !(target === shownHost || target.endsWith(`.${shownHost}`) || shownHost.endsWith(`.${target}`));
}

// risk: "high" when a strong signal is present (reasons say which), else "none". tips: weaker, advisory.
export function scanContent({ subject = "", previewText = "", body = "" } = {}) {
	const links = extractLinks(body);
	const text = `${subject} ${previewText} ${toPlainText(body)}`;
	const reasons = [];

	const mismatched = links.find(isMismatched);
	if (mismatched) reasons.push(`A link shows "${mismatched.text}" but goes to ${hostOf(mismatched.href)}`);
	const bad = links.find(({ href }) => /^(?:javascript|data|vbscript):/i.test(href) || EXECUTABLE_EXTENSIONS.test(href));
	if (bad) reasons.push("It links to a program or script to download or run");
	if (links.length > 0 && CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text))) reasons.push("It asks readers to verify or hand over account, password or payment details");
	if (CRYPTO_PATTERN.test(text)) reasons.push("It asks for crypto wallet secrets or promises to multiply crypto");
	if ((PRIZE_PATTERN.test(text) && FEE_PATTERN.test(text)) || GIFT_CARD_PATTERN.test(text)) reasons.push("It looks like a prize, inheritance or gift-card scam");

	const tips = [];
	const letters = subject.replace(/[^a-zA-Z]/g, "");
	if (letters.length >= 8 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.8) tips.push({ id: "caps", message: "The subject is all capital letters" });
	if (/[!?]{2,}/.test(subject)) tips.push({ id: "punctuation", message: "The subject has repeated ! or ?" });
	if (/^(?:re|fwd?):\s/i.test(subject.trim())) tips.push({ id: "fake-reply", message: "The subject starts with Re: or Fwd:, which looks like a fake reply" });
	const lower = `${subject} ${toPlainText(body)}`.toLowerCase();
	const words = SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
	if (words.length > 0) tips.push({ id: "phrases", message: `Spam filters dislike: ${words.slice(0, 6).join(", ")}`, words: words.slice(0, 6) });
	const shortener = links.map(({ href }) => hostOf(href)).find((host) => host && SHORTENERS.has(host));
	if (shortener) tips.push({ id: "shortener", message: `A link uses a shortener (${shortener}); filters distrust them` });

	return { risk: reasons.length > 0 ? "high" : "none", reasons, tips };
}
