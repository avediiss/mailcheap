import assert from "node:assert/strict";
import { test } from "node:test";
import { limitNewContacts } from "../lib/contact-import.js";
import {
	HEALTH_LABELS,
	describeAttention,
	MIN_SENT_FOR_HEALTH,
	formatLimit,
	getContactRoom,
	getEmailQuotaProblem,
	getHealth,
	getUsageMeter,
	parseLimit,
	rankAttention,
	readLimits,
	slugifyWorkspaceName,
} from "../lib/platform-rules.js";

test("a limit is a whole number, or empty for none", () => {
	assert.deepEqual(parseLimit(""), { value: null });
	assert.deepEqual(parseLimit("   "), { value: null });
	assert.deepEqual(parseLimit(null), { value: null });
	assert.deepEqual(parseLimit("0"), { value: 0 });
	assert.deepEqual(parseLimit("20,000"), { value: 20000 });
	assert.deepEqual(parseLimit(" 5 000 "), { value: 5000 });
	for (const bad of ["-1", "1.5", "ten", "1e3", "20k", "99999999999"]) assert.ok(parseLimit(bad).error, bad);
});

test("the limits form reports which field is wrong", () => {
	assert.deepEqual(readLimits({ contacts: "100", emailsPerMonth: "", newsletters: "3" }), { limits: { contacts: 100, emailsPerMonth: null, newsletters: 3 } });
	assert.match(readLimits({ contacts: "100", emailsPerMonth: "lots", newsletters: "" }).error, /^Emails per month:/);
	assert.deepEqual(readLimits(undefined), { limits: { contacts: null, emailsPerMonth: null, newsletters: null } });
	assert.equal(formatLimit(null), "No limit");
	assert.equal(formatLimit(20000), "20,000");
	assert.equal(formatLimit(0), "0");
});

test("a usage meter is full at the limit and near it from 80%", () => {
	assert.deepEqual(getUsageMeter({ used: 5, limit: null }), { used: 5, limit: null, ratio: 0, state: "unlimited" });
	assert.equal(getUsageMeter({ used: 0, limit: 100 }).state, "ok");
	assert.equal(getUsageMeter({ used: 79, limit: 100 }).state, "ok");
	assert.equal(getUsageMeter({ used: 80, limit: 100 }).state, "near");
	assert.equal(getUsageMeter({ used: 100, limit: 100 }).state, "full");
	assert.equal(getUsageMeter({ used: 140, limit: 100 }).ratio, 1, "the bar never overflows");
	assert.equal(getUsageMeter({ used: 0, limit: 0 }).state, "full", "a limit of zero is always full");
	assert.equal(getUsageMeter({ used: -3, limit: 10 }).used, 0);
});

test("a send must fit in what's left of the month, and says why when it doesn't", () => {
	assert.equal(getEmailQuotaProblem({ used: 100, limit: null, needed: 1_000_000 }), null);
	assert.equal(getEmailQuotaProblem({ used: 100, limit: 1000, needed: 900 }), null, "exactly the rest fits");
	assert.match(getEmailQuotaProblem({ used: 100, limit: 1000, needed: 901 }), /needs 901 emails, but only 900 are left of this month's 1,000/);
	assert.match(getEmailQuotaProblem({ used: 1000, limit: 1000, needed: 1 }), /used all 1,000 emails/);
	assert.match(getEmailQuotaProblem({ used: 1500, limit: 1000, needed: 1 }), /used all 1,000 emails/, "never negative");
});

test("contact room is what's left, and unlimited without a limit", () => {
	assert.equal(getContactRoom({ used: 10, limit: null }), Number.POSITIVE_INFINITY);
	assert.equal(getContactRoom({ used: 10, limit: 25 }), 15);
	assert.equal(getContactRoom({ used: 30, limit: 25 }), 0);
});

test("a CSV import takes new people only while there's room, and always keeps the ones already there", () => {
	const row = (email, status = "active") => ({ email, status });
	const contacts = [row("old@x.test"), row("new1@x.test"), row("new2@x.test"), row("new3@x.test"), row("left@x.test", "unsubscribed")];
	const existing = new Set(["old@x.test"]);
	const result = limitNewContacts(contacts, existing, 2);
	assert.deepEqual(result.accepted.map(({ email }) => email), ["old@x.test", "new1@x.test", "new2@x.test", "left@x.test"]);
	assert.equal(result.skipped, 1);
	assert.deepEqual(limitNewContacts(contacts, existing, 0).accepted.map(({ email }) => email), ["old@x.test", "left@x.test"], "no room: only what costs nothing");
	assert.equal(limitNewContacts(contacts, existing, Number.POSITIVE_INFINITY).accepted.length, 5);
	assert.equal(limitNewContacts(contacts, existing, Number.POSITIVE_INFINITY).skipped, 0);
});

test("health needs enough sends, then watches at half the pause threshold", () => {
	assert.equal(getHealth({ sent: 0, bounced: 0, complained: 0 }), "unknown");
	assert.equal(getHealth({ sent: MIN_SENT_FOR_HEALTH - 1, bounced: 49, complained: 0 }), "unknown");
	assert.equal(getHealth({ sent: 1000, bounced: 5, complained: 0 }), "good");
	assert.equal(getHealth({ sent: 1000, bounced: 12, complained: 0 }), "watch", "1.2% is over half of the 2% limit");
	assert.equal(getHealth({ sent: 1000, bounced: 20, complained: 0 }), "bad");
	assert.equal(getHealth({ sent: 10000, bounced: 0, complained: 9 }), "bad", "0.09% complaints passes the 0.08% limit");
	assert.equal(getHealth({ sent: 10000, bounced: 0, complained: 5 }), "watch");
	assert.ok(HEALTH_LABELS.bad && HEALTH_LABELS.good && HEALTH_LABELS.watch && HEALTH_LABELS.unknown);
});

test("workspace names become clean slugs", () => {
	assert.equal(slugifyWorkspaceName("Acme Studio"), "acme-studio");
	assert.equal(slugifyWorkspaceName("  Café & Co.  "), "cafe-co");
	assert.equal(slugifyWorkspaceName("---"), "");
	assert.equal(slugifyWorkspaceName("a".repeat(100)).length, 40);
	assert.equal(slugifyWorkspaceName(undefined), "");
});

test("what needs attention comes first: at risk, then suspended, then full", () => {
	const quiet = { name: "quiet", status: "active", health: "good", contactsMeter: { state: "ok" }, emailsMeter: { state: "unlimited" }, newslettersMeter: { state: "ok" } };
	const risky = { ...quiet, name: "risky", health: "bad" };
	const suspended = { ...quiet, name: "suspended", status: "suspended" };
	const full = { ...quiet, name: "full", emailsMeter: { state: "full" } };
	const near = { ...quiet, name: "near", contactsMeter: { state: "near" } };
	assert.deepEqual(rankAttention([quiet, near, full, suspended, risky]).map(({ name }) => name), ["risky", "suspended", "full", "near"]);
	assert.deepEqual(rankAttention([quiet]), []);
});

test("the attention list says why, most serious first", () => {
	const base = { status: "active", health: "good", contactsMeter: { state: "ok" }, emailsMeter: { state: "ok" }, newslettersMeter: { state: "ok" } };
	assert.deepEqual(describeAttention(base), []);
	assert.deepEqual(describeAttention({ ...base, health: "bad", status: "suspended", emailsMeter: { state: "full" }, contactsMeter: { state: "near" } }), [
		"Bounces or complaints are past the pause limit",
		"Suspended",
		"Emails limit reached",
		"Contacts close to the limit",
	]);
	assert.deepEqual(describeAttention({ ...base, health: "watch" }), ["Bounces or complaints are getting close to the limit"]);
});
