import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArchiveHostUrl, getArchiveHost, getArchiveHostProblem, getArchiveUrls } from "../lib/archive-hosts.js";
import { describeDomainStatus, findDomainConflict, getDomainProblem, normalizeDomain } from "../lib/domain-rules.js";
import { buildInvitationEmail } from "../lib/invitation-email.js";
import {
	INVITE_TTL_MS,
	MAX_PENDING_INVITATIONS,
	createInviteToken,
	getInviteExpiry,
	getInviteProblem,
	getInviteState,
	getMemberChangeProblem,
	hashInviteToken,
	isInviteUsable,
	looksLikeInviteToken,
	roleLabel,
} from "../lib/invitation-rules.js";

const NOW = Date.UTC(2026, 9, 20, 12);

test("invitations expire after a week, and each state says why a link can't be used", () => {
	assert.equal(INVITE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
	assert.equal(getInviteExpiry(NOW).getTime() - NOW, INVITE_TTL_MS);
	const future = new Date(NOW + 1000);
	assert.equal(getInviteState({ status: "pending", expiresAt: future }, NOW), "usable");
	assert.equal(getInviteState({ status: "pending", expiresAt: new Date(NOW - 1) }, NOW), "expired");
	assert.equal(getInviteState({ status: "accepted", expiresAt: future }, NOW), "accepted");
	assert.equal(getInviteState({ status: "revoked", expiresAt: future }, NOW), "revoked");
	assert.equal(getInviteState(null, NOW), "invalid");
	assert.equal(isInviteUsable({ status: "pending", expiresAt: future }, NOW), true);
	assert.equal(isInviteUsable({ status: "revoked", expiresAt: future }, NOW), false);
	assert.equal(isInviteUsable(undefined, NOW), false);
});

test("invite tokens are random, stored as a hash, and nothing else looks like one", () => {
	const a = createInviteToken();
	const b = createInviteToken();
	assert.notEqual(a.token, b.token);
	assert.equal(looksLikeInviteToken(a.token), true);
	assert.equal(hashInviteToken(a.token), a.tokenHash);
	assert.notEqual(a.tokenHash, a.token);
	for (const bad of [undefined, "", "short", { $ne: 1 }, "x".repeat(44)]) assert.equal(looksLikeInviteToken(bad), false);
});

test("who can be invited", () => {
	const base = { email: "new@example.com", role: "editor", memberEmails: ["owner@example.com"], pendingCount: 0 };
	assert.equal(getInviteProblem(base), null);
	assert.match(getInviteProblem({ ...base, email: null }), /valid email/);
	assert.match(getInviteProblem({ ...base, role: "admin" }), /Pick a role/);
	assert.match(getInviteProblem({ ...base, email: "owner@example.com" }), /already in this workspace/);
	assert.match(getInviteProblem({ ...base, memberEmails: ["NEW@Example.com"] }), /already in this workspace/);
	assert.match(getInviteProblem({ ...base, pendingCount: MAX_PENDING_INVITATIONS }), /at most/);
});

test("a workspace never loses its last owner", () => {
	const members = [{ userId: "1", role: "owner" }, { userId: "2", role: "editor" }];
	assert.match(getMemberChangeProblem({ members, targetUserId: "1", action: "remove" }), /at least one owner/);
	assert.match(getMemberChangeProblem({ members, targetUserId: "1", action: "role", newRole: "editor" }), /at least one owner/);
	assert.equal(getMemberChangeProblem({ members, targetUserId: "1", action: "role", newRole: "owner" }), null, "no change is fine");
	assert.equal(getMemberChangeProblem({ members, targetUserId: "2", action: "remove" }), null);
	assert.equal(getMemberChangeProblem({ members, targetUserId: "2", action: "role", newRole: "owner" }), null);
	const two = [{ userId: "1", role: "owner" }, { userId: "2", role: "owner" }];
	assert.equal(getMemberChangeProblem({ members: two, targetUserId: "1", action: "remove" }), null);
	assert.match(getMemberChangeProblem({ members, targetUserId: "9", action: "remove" }), /not in the workspace/);
	assert.match(getMemberChangeProblem({ members, targetUserId: "2", action: "role", newRole: "boss" }), /Pick a role/);
	assert.equal(roleLabel("owner"), "Owner");
	assert.equal(roleLabel("editor"), "Editor");
});

test("the invitation email names the workspace and role, links, and escapes names", () => {
	const email = buildInvitationEmail({ url: "https://app.example.com/invite/abc", workspaceName: "<i>Acme</i>", inviterName: "Ana", role: "owner" });
	assert.equal(email.subject, "Ana invited you to <i>Acme</i> on Namag");
	assert.ok(email.text.includes("https://app.example.com/invite/abc") && email.text.includes("an owner"));
	assert.ok(!email.html.includes("<i>Acme</i>") && email.html.includes("&lt;i&gt;Acme&lt;/i&gt;"));
	assert.match(buildInvitationEmail({ url: "u", workspaceName: "W", role: "editor" }).subject, /^Someone invited you to W/);
});

test("domains are normalized from whatever people paste", () => {
	assert.equal(normalizeDomain("  Example.COM "), "example.com");
	assert.equal(normalizeDomain("https://news.example.com/path?x=1#y"), "news.example.com");
	assert.equal(normalizeDomain("hello@example.com"), "example.com");
	assert.equal(normalizeDomain("example.com:8080"), "example.com");
	assert.equal(normalizeDomain("example.com."), "example.com");
	assert.equal(normalizeDomain(""), null);
	assert.equal(normalizeDomain(undefined), null);
});

test("what is and isn't a usable domain", () => {
	assert.equal(getDomainProblem("example.com"), null);
	assert.equal(getDomainProblem("news.example.co.uk"), null);
	assert.equal(getDomainProblem("xn--caf-dma.fr"), null);
	assert.match(getDomainProblem(null), /Enter a domain/);
	assert.match(getDomainProblem("localhost"), /full domain/);
	assert.match(getDomainProblem("a_b.example.com"), /doesn't look like a domain/);
	assert.match(getDomainProblem("-bad.example.com"), /doesn't look like a domain/);
	assert.match(getDomainProblem("exa mple.com"), /doesn't look like a domain/);
	assert.match(getDomainProblem("1.2.3.4"), /IP address/);
	assert.match(getDomainProblem("gmail.com"), /public email service/);
	assert.match(getDomainProblem(`${"a".repeat(64)}.com`), /doesn't look like a domain/);
});

test("two workspaces can't hold a domain and its parent or child", () => {
	assert.equal(findDomainConflict("example.com", ["other.org"]), null);
	assert.equal(findDomainConflict("example.com", ["example.com"]), "example.com");
	assert.equal(findDomainConflict("news.example.com", ["example.com"]), "example.com");
	assert.equal(findDomainConflict("example.com", ["news.example.com"]), "news.example.com");
	assert.equal(findDomainConflict("notexample.com", ["example.com"]), null, "only real subdomains conflict");
	assert.equal(findDomainConflict("example.com", []), null);
	assert.equal(findDomainConflict("example.com", undefined), null);
});

test("a domain's status reads plainly", () => {
	assert.equal(describeDomainStatus({ ses: { verified: true } }).key, "verified");
	assert.equal(describeDomainStatus({ ses: { verified: false } }).key, "pending");
	assert.equal(describeDomainStatus({ ses: null }).key, "missing");
});

test("a newsletter's own archive domain wins over the environment variable, and neither is needed", () => {
	const env = "legacy.example.org=weekly";
	assert.equal(getArchiveHost("weekly", env), "legacy.example.org");
	assert.equal(getArchiveHost("weekly", env, "news.mine.org"), "news.mine.org");
	assert.equal(getArchiveHost("other", env), null);
	const urls = getArchiveUrls({ slug: "weekly", archiveHost: "news.mine.org" }, "", "https://app.example.com");
	assert.equal(urls.host, "news.mine.org");
	assert.equal(urls.absolutePost("issue-1"), "https://news.mine.org/p/issue-1");
	assert.equal(urls.siteIndex, "https://news.mine.org/");
	const plain = getArchiveUrls({ slug: "weekly" }, "", "https://app.example.com");
	assert.equal(plain.host, null);
	assert.equal(plain.absolutePost("issue-1"), "https://app.example.com/archive/weekly/p/issue-1");
	assert.equal(buildArchiveHostUrl("news.mine.org", "/sitemap", "?a=1"), "https://news.mine.org/sitemap.xml?a=1");
	assert.equal(buildArchiveHostUrl("news.mine.org", undefined), "https://news.mine.org/");
});

test("archive domains must be real hostnames that aren't the dashboard", () => {
	assert.equal(getArchiveHostProblem("", "app.example.com"), null, "none is fine");
	assert.equal(getArchiveHostProblem("news.example.org", "app.example.com"), null);
	assert.match(getArchiveHostProblem("nodots", "app.example.com"), /domain name like/);
	assert.match(getArchiveHostProblem("1.2.3.4", "app.example.com"), /IP address/);
	assert.match(getArchiveHostProblem("App.Example.com", "app.example.com"), /dashboard's own address/);
	assert.match(getArchiveHostProblem("bad_host.example.org", "app.example.com"), /domain name like/);
});

test("the administrator invitation names the platform, not a workspace or a role", () => {
	const email = buildInvitationEmail({ url: "https://app.test/invite/abc", workspaceName: "", inviterName: "Avedis", platform: true });
	assert.match(email.subject, /Avedis invited you to run Namag/);
	assert.ok(email.text.includes("https://app.test/invite/abc"));
	assert.doesNotMatch(email.text, /editor|owner/i);
});
