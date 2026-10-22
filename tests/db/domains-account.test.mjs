import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, logout, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme", withEditor: true });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
});

const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};

test("an owner adds a domain: it is normalized, set up in SES and belongs to the workspace", async () => {
	const { addDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(a.owner);
	const result = await addDomain(null, form({ domain: "  https://Mail.Example-Acme.io/some/path " }));
	assert.deepEqual(result, { ok: true, domain: "mail.example-acme.io" });
	const row = await db.models.Domain.findOne({ domain: "mail.example-acme.io" });
	assert.equal(String(row.workspaceId), id(a.workspace));
	assert.equal(row.createdInSes, true);
	assert.equal(String(row.addedBy), id(a.owner));
	assert.ok(globalThis.__sesIdentities.has("mail.example-acme.io"));

	// The new domain lets the workspace choose from addresses on it.
	const { isSenderAllowed } = await import("@/lib/workspace-rules");
	const { listWorkspaceDomains } = await import("@/lib/workspace");
	assert.equal(isSenderAllowed(await listWorkspaceDomains(a.workspace._id), "news@mail.example-acme.io"), true);
});

test("bad domains are refused before anything is created", async () => {
	const { addDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(a.owner);
	for (const [input, pattern] of [
		["", /Enter a domain/],
		["localhost", /full domain/],
		["not a domain.com", /doesn't look like a domain/],
		["192.168.0.1", /IP address/],
		["gmail.com", /public email service/],
		["a".repeat(70) + ".com", /doesn't look like a domain/],
	]) {
		assert.match((await addDomain(null, form({ domain: input }))).error, pattern, input);
	}
	assert.equal(globalThis.__sesIdentities.size, 0);
	assert.equal(await db.models.Domain.countDocuments({ workspaceId: a.workspace._id }), 1, "only the one from the fixture");
});

test("a workspace can't claim a domain, a parent or a subdomain of another workspace's", async () => {
	const { addDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(b.owner);
	assert.match((await addDomain(null, form({ domain: "acme.test" }))).error, /already used by a workspace/);
	assert.match((await addDomain(null, form({ domain: "news.acme.test" }))).error, /acme\.test is already used by another workspace/);
	await db.models.Domain.create({ workspaceId: a.workspace._id, domain: "deep.corp.example.com" });
	assert.match((await addDomain(null, form({ domain: "corp.example.com" }))).error, /deep\.corp\.example\.com is already used/);
	assert.equal(globalThis.__sesIdentities.size, 0);
});

test("editors can't add or remove domains, and nobody can remove another workspace's", async () => {
	const { addDomain, removeDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(a.editor);
	assert.equal((await addDomain(null, form({ domain: "editor-added.io" }))).error, "Only a workspace owner can manage domains");
	const ownDomain = await db.models.Domain.findOne({ workspaceId: a.workspace._id });
	assert.equal((await removeDomain(id(ownDomain))).error, "Only a workspace owner can manage domains");

	await loginAs(b.owner);
	assert.equal((await removeDomain(id(ownDomain))).error, "Domain not found");
	assert.ok(await db.models.Domain.exists({ _id: ownDomain._id }));
});

test("when AWS refuses or already has the domain, the person gets a clear answer and nothing is stored", async () => {
	const { addDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(a.owner);
	globalThis.__sesBehavior = { create: "denied" };
	assert.match((await addDomain(null, form({ domain: "denied.io" }))).error, /ses:CreateEmailIdentity/);
	globalThis.__sesBehavior = { create: "failed" };
	assert.match((await addDomain(null, form({ domain: "failed.io" }))).error, /couldn't add this domain/);
	globalThis.__sesBehavior = { create: "exists" };
	assert.match((await addDomain(null, form({ domain: "taken.io" }))).error, /already set up in the sending service/);
	assert.equal(await db.models.Domain.countDocuments({ domain: { $in: ["denied.io", "failed.io", "taken.io"] } }), 0);

	// The platform owner can assign a domain they set up in SES by hand, without being inside the workspace.
	// Removing it afterwards never deletes it from SES.
	const root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
	await loginAs(root);
	const { assignDomain } = await import("@/app/(app)/platform/actions");
	globalThis.__sesBehavior = { create: "exists" };
	assert.deepEqual(await assignDomain(null, form({ id: id(a.workspace), domain: "taken.io" })), { ok: true, domain: "taken.io" });
	const adopted = await db.models.Domain.findOne({ domain: "taken.io" });
	assert.equal(adopted.createdInSes, false);
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.domain" }), 1);
	globalThis.__sesBehavior = undefined;
	await loginAs(a.owner);
	globalThis.__sesIdentities.add("taken.io");
	const { removeDomain } = await import("@/app/(app)/domains/actions");
	assert.deepEqual(await removeDomain(id(adopted)), { ok: true });
	assert.ok(globalThis.__sesIdentities.has("taken.io"), "still in SES");
});

test("removing a domain is refused while a newsletter sends from it, then removes it from SES", async () => {
	const { addDomain, removeDomain } = await import("@/app/(app)/domains/actions");
	await loginAs(a.owner);
	await addDomain(null, form({ domain: "second.io" }));
	const second = await db.models.Domain.findOne({ domain: "second.io" });
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { fromEmail: "hi@news.second.io" } });

	assert.match((await removeDomain(id(second))).error, /Acme weekly still sends from second\.io/);
	assert.ok(await db.models.Domain.exists({ _id: second._id }));

	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { fromEmail: "hi@acme.test" } });
	globalThis.__sesBehavior = { delete: true };
	assert.match((await removeDomain(id(second))).error, /couldn't remove/);
	assert.ok(await db.models.Domain.exists({ _id: second._id }), "kept when SES fails, so nothing is half-removed");
	globalThis.__sesBehavior = undefined;
	assert.deepEqual(await removeDomain(id(second)), { ok: true });
	assert.equal(await db.models.Domain.countDocuments({ domain: "second.io" }), 0);
	assert.ok(!globalThis.__sesIdentities.has("second.io"));
});

test("the domain list shows each domain's live state, and survives SES being down", async () => {
	const { listWorkspaceDomainStatuses } = await import("@/lib/domains");
	await db.models.Domain.create({ workspaceId: a.workspace._id, domain: "pending.io" });
	await db.models.Domain.create({ workspaceId: a.workspace._id, domain: "missing.io" });
	globalThis.__sesDomains = [
		{ domain: "acme.test", verified: true, dkimStatus: "SUCCESS", records: [] },
		{ domain: "pending.io", verified: false, dkimStatus: "PENDING", records: [{ type: "CNAME", name: "x._domainkey.pending.io", value: "x.dkim.amazonses.com" }] },
		{ domain: "birch.test", verified: true, records: [] },
	];

	const { domains, sesError } = await listWorkspaceDomainStatuses(a.workspace._id);
	assert.equal(sesError, null);
	assert.deepEqual(Object.fromEntries(domains.map(({ domain, status }) => [domain, status.key])), { "acme.test": "verified", "pending.io": "pending", "missing.io": "missing" });
	assert.equal(domains.find(({ domain }) => domain === "pending.io").records.length, 1);
	assert.ok(!domains.some(({ domain }) => domain === "birch.test"), "another workspace's domain never shows");

	globalThis.__sesDomains = { error: "network down" };
	const down = await listWorkspaceDomainStatuses(a.workspace._id);
	assert.equal(down.sesError, "network down");
	assert.equal(down.domains.length, 3);
	assert.ok(down.domains.every(({ status }) => status.key === "unknown"));
});

test("a domain on the list that SES doesn't have yet can be set up, by an owner, in its own workspace", async () => {
	const { setUpDomain } = await import("@/app/(app)/domains/actions");
	const pending = await db.models.Domain.create({ workspaceId: a.workspace._id, domain: "assigned.io" });

	await loginAs(a.editor);
	assert.equal((await setUpDomain(id(pending))).error, "Only a workspace owner can manage domains");
	await loginAs(b.owner);
	assert.equal((await setUpDomain(id(pending))).error, "Domain not found");
	assert.equal(globalThis.__sesIdentities.size, 0);

	await loginAs(a.owner);
	globalThis.__sesBehavior = { create: "denied" };
	assert.match((await setUpDomain(id(pending))).error, /ses:CreateEmailIdentity/);
	globalThis.__sesBehavior = undefined;
	assert.deepEqual(await setUpDomain(id(pending)), { ok: true });
	assert.ok(globalThis.__sesIdentities.has("assigned.io"));
	assert.equal((await db.models.Domain.findById(pending._id)).createdInSes, true);
	assert.deepEqual(await setUpDomain(id(pending)), { ok: true }, "doing it twice is harmless");
});

test("account: the name can be set and cleared", async () => {
	const { updateProfile } = await import("@/app/(app)/account/actions");
	await loginAs(a.owner);
	assert.deepEqual(await updateProfile(null, form({ name: "  Ana Owner  " })), { ok: true });
	assert.equal((await db.models.User.findById(a.owner._id)).name, "Ana Owner");
	assert.match((await updateProfile(null, form({ name: "x".repeat(121) }))).error, /under 120/);
	assert.deepEqual(await updateProfile(null, form({ name: "" })), { ok: true });
	assert.equal((await db.models.User.findById(a.owner._id)).name, undefined);
});

test("account: changing the password checks the current one, keeps this device signed in and signs the others out", async () => {
	const { changePassword } = await import("@/app/(app)/account/actions");
	const { getSession, authenticate } = await import("@/lib/auth");
	const { SESSION_COOKIE } = await import("@/lib/session-token");
	const { jar } = await loginAs(a.owner);
	const otherDevice = jar.get(SESSION_COOKIE);
	const change = (fields) => changePassword(null, form({ current: "a long enough password", password: "a brand new password", confirm: "a brand new password", ...fields }));

	assert.match((await change({ confirm: "different" })).error, /don't match/);
	assert.match((await change({ password: "short", confirm: "short" })).error, /at least/);
	assert.match((await change({ current: "not my password" })).error, /current password is wrong/);
	assert.match((await change({ password: "a long enough password", confirm: "a long enough password" })).error, /haven't used/);

	assert.deepEqual(await change({}), { ok: true });
	assert.ok(await getSession(), "this device stays signed in");
	assert.ok(await authenticate(a.owner.email, "a brand new password"));
	assert.equal(await authenticate(a.owner.email, "a long enough password"), null);

	const thisDevice = jar.get(SESSION_COOKIE);
	jar.set(SESSION_COOKIE, otherDevice);
	assert.equal(await getSession(), null, "the old cookie is dead");
	jar.set(SESSION_COOKIE, thisDevice);
	assert.ok(await getSession());
});

test("account: too many wrong current passwords are slowed down", async () => {
	const { changePassword } = await import("@/app/(app)/account/actions");
	await loginAs(a.owner);
	let last;
	for (let attempt = 0; attempt < 7; attempt++) {
		last = await changePassword(null, form({ current: "wrong wrong wrong", password: "a brand new password", confirm: "a brand new password" }));
	}
	assert.match(last.error, /Too many attempts/);
});

test("account: signing out everywhere ends every session, this one included", async () => {
	const { signOutEverywhere } = await import("@/app/(app)/account/actions");
	const { getSession } = await import("@/lib/auth");
	const { SESSION_COOKIE } = await import("@/lib/session-token");
	const { jar } = await loginAs(a.owner);
	const token = jar.get(SESSION_COOKIE);

	assert.equal((await catching(() => signOutEverywhere())).redirectTo, "/login");
	assert.equal(await getSession(), null);
	jar.set(SESSION_COOKIE, token);
	assert.equal(await getSession(), null, "the cookie from before doesn't work again");
	logout();
});
