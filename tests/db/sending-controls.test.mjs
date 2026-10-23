import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let root;
let a;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	const { clearAddressCaches } = await import("@/lib/address-check");
	clearAddressCaches();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	root = await db.models.User.create({ email: "root@platform.test", passwordHash: "x", isPlatformAdmin: true });
});

const id = (doc) => String(doc._id);
const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};

test("an administrator sets a client as trusted or gives it a daily amount, and both are recorded; no one else can", async () => {
	const { updateSendingAction } = await import("@/app/(app)/platform/actions");
	await loginAs(a.owner);
	assert.equal((await catching(() => updateSendingAction(null, form({ id: id(a.workspace), isTrusted: "on" })))).redirectTo, "/");
	assert.equal((await db.models.Workspace.findById(a.workspace._id)).sendingTrust.isTrusted, false);

	await loginAs(root);
	assert.deepEqual(await updateSendingAction(null, form({ id: id(a.workspace), isTrusted: "on", dailyCap: "" })), { ok: true });
	let workspace = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(workspace.sendingTrust.isTrusted, true);
	assert.equal(workspace.sendingTrust.dailyCap, undefined);

	assert.deepEqual(await updateSendingAction(null, form({ id: id(a.workspace), dailyCap: "1,500" })), { ok: true });
	workspace = await db.models.Workspace.findById(a.workspace._id);
	assert.equal(workspace.sendingTrust.isTrusted, false);
	assert.equal(workspace.sendingTrust.dailyCap, 1500);
	assert.equal(await db.models.AuditLog.countDocuments({ workspaceId: a.workspace._id, action: "workspace.sending" }), 2);

	for (const bad of ["0", "-5", "12.5", "lots", "1e9"]) assert.match((await updateSendingAction(null, form({ id: id(a.workspace), dailyCap: bad }))).error, /whole number/);
	assert.equal((await updateSendingAction(null, form({ id: "nope" }))).error, "Workspace not found");
	assert.equal((await db.models.Workspace.findById(a.workspace._id)).sendingTrust.dailyCap, 1500, "bad input changed nothing");
});

test("the console's summaries say who is warming up, who is trusted and who is blocked", async () => {
	const { listWorkspaceSummaries } = await import("@/lib/platform");
	const ago = (days) => new Date(Date.now() - days * 86400_000);
	const b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	const c = await makeTenant(db.models, { name: "Cedar", slug: "cedar" });
	const send = (tenant, days) => db.models.Message.create({ kind: "welcome", workspaceId: tenant.workspace._id, newsletterId: tenant.newsletter._id, email: "x@example.com", status: "sent", sentAt: ago(days) });
	await send(a, 5);
	await send(b, 45);
	await send(c, 5);
	await db.models.Workspace.updateOne({ _id: c.workspace._id }, { $set: { sendingTrust: { isTrusted: true }, status: "suspended", blockReason: "7.0% bounced" } });

	const rows = await listWorkspaceSummaries();
	const by = (slug) => rows.find((row) => row.slug === slug);
	assert.deepEqual([by("acme").isWarmingUp, by("acme").warmupDay], [true, 6]);
	assert.equal(by("birch").isWarmingUp, false, "past its first month");
	assert.equal(by("cedar").isWarmingUp, false, "trusted");
	assert.equal(by("cedar").isTrusted, true);
	assert.equal(by("cedar").blockReason, "7.0% bounced");
});

test("the platform's blocklist is managed by administrators only, normalises what is typed, and records each change", async () => {
	const { addBlockedDomainAction, removeBlockedDomainAction } = await import("@/app/(app)/platform/actions");
	await loginAs(a.owner);
	assert.equal((await catching(() => addBlockedDomainAction(null, form({ domain: "spam.example" })))).redirectTo, "/");
	assert.equal(await db.models.BlockedDomain.countDocuments(), 0);

	await loginAs(root);
	assert.deepEqual(await addBlockedDomainAction(null, form({ domain: "  HTTPS://Spam.Example/  ", reason: "bulk junk" })), { ok: true, domain: "spam.example" });
	assert.equal((await db.models.BlockedDomain.findOne({ domain: "spam.example" })).reason, "bulk junk");
	assert.match((await addBlockedDomainAction(null, form({ domain: "spam.example" }))).error, /already blocked/);
	assert.match((await addBlockedDomainAction(null, form({ domain: "not a domain" }))).error, /domain/i);
	assert.match((await addBlockedDomainAction(null, form({ domain: "gmail.com" }))).error, /public email service/);

	assert.deepEqual(await removeBlockedDomainAction("SPAM.example"), { ok: true });
	assert.match((await removeBlockedDomainAction("spam.example")).error, /isn't blocked/);
	assert.deepEqual((await db.models.AuditLog.find({ action: /^blocklist/ }).sort({ createdAt: 1 })).map(({ action }) => action), ["blocklist.added", "blocklist.removed"]);
});
