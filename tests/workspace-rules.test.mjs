import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAlertRecipients } from "../lib/alert-audience.js";
import {
	buildSuppressionIndex,
	filterDomainsForWorkspace,
	getEmailDomain,
	getLimitProblem,
	getSendGateProblem,
	getSuppressionScope,
	hasRole,
	isSenderAllowed,
	isSuppressedFor,
	pickActiveWorkspace,
	suppressionFilter,
} from "../lib/workspace-rules.js";

test("owners can do what editors can, not the other way round, and unknown roles can do nothing", () => {
	assert.equal(hasRole("owner", "owner"), true);
	assert.equal(hasRole("owner", "editor"), true);
	assert.equal(hasRole("editor", "editor"), true);
	assert.equal(hasRole("editor", "owner"), false);
	for (const role of [undefined, null, "", "admin", "viewer"]) assert.equal(hasRole(role, "editor"), false);
	assert.equal(hasRole("owner", "superuser"), false, "an unknown requirement is never met");
});

test("the active workspace is the one picked last if still allowed, else the first", () => {
	const list = [{ id: "a" }, { id: "b" }];
	assert.equal(pickActiveWorkspace(list, "b").id, "b");
	assert.equal(pickActiveWorkspace(list, "c").id, "a", "a workspace you can't use is ignored");
	assert.equal(pickActiveWorkspace(list, undefined).id, "a");
	assert.equal(pickActiveWorkspace([], "a"), null);
	assert.equal(pickActiveWorkspace(undefined, "a"), null);
});

test("a workspace sends from its own domains and their subdomains, and nothing that only looks similar", () => {
	const own = ["example.com"];
	assert.equal(isSenderAllowed(own, "hi@example.com"), true);
	assert.equal(isSenderAllowed(own, "Hi@EXAMPLE.com"), true);
	assert.equal(isSenderAllowed(own, "hi@news.example.com"), true);
	for (const bad of ["hi@notexample.com", "hi@example.com.evil.test", "hi@evil.test", "hi@", "no-at-sign", "", undefined, "a@b@evil.test"]) {
		assert.equal(isSenderAllowed(own, bad), false, String(bad));
	}
	assert.equal(isSenderAllowed([], "hi@example.com"), false);
	assert.equal(isSenderAllowed(undefined, "hi@example.com"), false);
	assert.equal(isSenderAllowed(["", " "], "hi@example.com"), false, "an empty domain matches nothing");
	assert.equal(getEmailDomain("Dana <dana@Example.com>".split("<")[1]?.replace(">", "")), "example.com");
});

test("the domain list a person sees is cut down to their own", () => {
	const ses = [{ domain: "mine.com" }, { domain: "news.mine.com" }, { domain: "theirs.com" }, { domain: "notmine.com" }];
	assert.deepEqual(filterDomainsForWorkspace(ses, ["mine.com"]).map(({ domain }) => domain), ["mine.com", "news.mine.com"]);
	assert.deepEqual(filterDomainsForWorkspace(ses, []), []);
	assert.deepEqual(filterDomainsForWorkspace(undefined, ["mine.com"]), []);
});

test("bounces are global and everything else belongs to a workspace", () => {
	assert.equal(getSuppressionScope("bounce", "ws1"), null);
	assert.equal(getSuppressionScope("complaint", "ws1"), "ws1");
	assert.equal(getSuppressionScope("manual", "ws1"), "ws1");
	assert.equal(getSuppressionScope("complaint", undefined), null, "a complaint we can't attribute counts everywhere");
	assert.deepEqual(suppressionFilter("ws1"), { $or: [{ workspaceId: null }, { workspaceId: "ws1" }] });
});

test("a batch's suppressions are checked per workspace in one pass", () => {
	const index = buildSuppressionIndex([
		{ email: "bounced@x.test" },
		{ email: "bounced-too@x.test", workspaceId: null },
		{ email: "complained@x.test", workspaceId: "ws1" },
	]);
	assert.equal(isSuppressedFor(index, "ws1", "bounced@x.test"), true);
	assert.equal(isSuppressedFor(index, "ws2", "bounced@x.test"), true, "a bounce is everyone's");
	assert.equal(isSuppressedFor(index, "ws1", "complained@x.test"), true);
	assert.equal(isSuppressedFor(index, "ws2", "complained@x.test"), false, "a complaint is only ws1's");
	assert.equal(isSuppressedFor(index, "ws1", "fine@x.test"), false);
	assert.equal(isSuppressedFor(buildSuppressionIndex(undefined), "ws1", "a@x.test"), false);
});

test("the send gate stops suspended workspaces, missing workspaces and foreign from addresses", () => {
	const workspace = { status: "active" };
	assert.equal(getSendGateProblem({ workspace, domains: ["acme.test"], fromEmail: "hi@acme.test" }), null);
	assert.match(getSendGateProblem({ workspace: undefined, domains: ["acme.test"], fromEmail: "hi@acme.test" }), /no longer exists/);
	assert.match(getSendGateProblem({ workspace: { status: "suspended" }, domains: ["acme.test"], fromEmail: "hi@acme.test" }), /suspended/);
	assert.match(getSendGateProblem({ workspace, domains: ["acme.test"], fromEmail: "hi@birch.test" }), /hi@birch\.test is not on one of this workspace/);
	assert.match(getSendGateProblem({ workspace, domains: [], fromEmail: "hi@acme.test" }), /not on one of this workspace/);
	assert.match(getSendGateProblem({ workspace, domains: ["acme.test"], fromEmail: undefined }), /from address/);
});

test("limits stop at the limit and null means no limit", () => {
	assert.equal(getLimitProblem({ limit: null, current: 999, noun: "newsletters" }), null);
	assert.equal(getLimitProblem({ limit: undefined, current: 999, noun: "newsletters" }), null);
	assert.equal(getLimitProblem({ limit: 3, current: 2, noun: "newsletters" }), null);
	assert.match(getLimitProblem({ limit: 3, current: 3, noun: "newsletters" }), /limit of 3 newsletters/);
	assert.match(getLimitProblem({ limit: 0, current: 0, noun: "newsletters" }), /limit of 0/);
});

test("alerts go to the platform owner, the workspace's owners, or both, without duplicates", () => {
	const ownerEmails = ["Owner@Acme.test", "second@acme.test"];
	const platformEmail = "root@platform.test";
	assert.deepEqual(resolveAlertRecipients({ ownerEmails, platformEmail }), ["root@platform.test"], "the default is the platform owner");
	assert.deepEqual(resolveAlertRecipients({ audience: "owners", ownerEmails, platformEmail }), ["owner@acme.test", "second@acme.test"]);
	assert.deepEqual(resolveAlertRecipients({ audience: "owners+platform", ownerEmails, platformEmail }), ["owner@acme.test", "second@acme.test", "root@platform.test"]);
	assert.deepEqual(resolveAlertRecipients({ audience: "owners+platform", ownerEmails: ["root@platform.test"], platformEmail }), ["root@platform.test"], "no duplicates");
	assert.deepEqual(resolveAlertRecipients({ audience: "owners", ownerEmails: [], platformEmail }), [], "a workspace with no owners tells nobody");
	assert.deepEqual(resolveAlertRecipients({ audience: "platform", ownerEmails, platformEmail: undefined }), []);
});
