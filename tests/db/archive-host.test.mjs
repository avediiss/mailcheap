import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
let b;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	delete process.env.ARCHIVE_HOSTS;
	const { clearArchiveHostCache } = await import("@/lib/archive-host-lookup");
	clearArchiveHostCache();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
});

const id = (doc) => String(doc._id);
function settings(tenant, fields) {
	const data = new FormData();
	const base = { id: id(tenant.newsletter), name: "Weekly", slug: tenant.newsletter.slug, fromEmail: tenant.newsletter.fromEmail, replyTo: `info@${tenant.domain}`, archiveEnabled: "on", ...fields };
	for (const [key, value] of Object.entries(base)) data.set(key, value);
	return data;
}

test("a newsletter's archive domain is saved normalized, and starts serving its archive", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	const { resolveArchiveSlug, clearArchiveHostCache } = await import("@/lib/archive-host-lookup");
	await loginAs(a.owner);
	assert.deepEqual(await saveNewsletter(null, settings(a, { archiveHost: "  https://News.Acme-Letters.org/ " }))?.then((result) => ({ ok: result.ok })), { ok: true });
	assert.equal((await db.models.Newsletter.findById(a.newsletter._id)).archiveHost, "news.acme-letters.org");

	clearArchiveHostCache();
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), "acme-weekly");
	assert.equal(await resolveArchiveSlug("NEWS.ACME-LETTERS.ORG:443"), "acme-weekly", "host header with a port and capitals");
	assert.equal(await resolveArchiveSlug("other.example.org"), null);
	assert.ok(globalThis.__sentEmails.some(({ subject, to }) => /Archive domain set/.test(subject) && to === process.env.ADMIN_EMAIL), "the platform owner is told to attach it");
});

test("clearing the domain removes it, and a domain can serve only one archive", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	await saveNewsletter(null, settings(a, { archiveHost: "news.shared.org" }));
	await saveNewsletter(null, settings(a, { archiveHost: "" }));
	assert.equal((await db.models.Newsletter.findById(a.newsletter._id)).archiveHost, undefined);

	await saveNewsletter(null, settings(a, { archiveHost: "news.shared.org" }));
	await loginAs(b.owner);
	assert.match((await saveNewsletter(null, settings(b, { archiveHost: "news.shared.org" }))).error, /already serves another archive/);
	assert.equal((await db.models.Newsletter.findById(b.newsletter._id)).archiveHost, undefined);
});

test("bad archive domains are refused: not a domain, an IP, or the dashboard itself", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	assert.match((await saveNewsletter(null, settings(a, { archiveHost: "not a domain" }))).error, /domain name like/);
	assert.match((await saveNewsletter(null, settings(a, { archiveHost: "10.0.0.1" }))).error, /IP address/);
	assert.match((await saveNewsletter(null, settings(a, { archiveHost: "mailcheap.test" }))).error, /dashboard's own address/);
	process.env.ARCHIVE_HOSTS = "taken.example.org=birch-weekly";
	assert.match((await saveNewsletter(null, settings(a, { archiveHost: "taken.example.org" }))).error, /already serves another newsletter/);
	assert.equal((await db.models.Newsletter.findById(a.newsletter._id)).archiveHost, undefined);
});

test("an archive stops being served when its workspace is suspended or its archive is switched off", async () => {
	const { resolveArchiveSlug, clearArchiveHostCache } = await import("@/lib/archive-host-lookup");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveHost: "news.acme-letters.org", archiveEnabled: true } });
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), "acme-weekly");

	clearArchiveHostCache();
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "suspended" } });
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), null);

	clearArchiveHostCache();
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "active" } });
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveEnabled: false } });
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), null);
});

test("answers are cached for a minute, the environment variable still works, and the dashboard host is never looked up", async () => {
	const { resolveArchiveSlug, resolveArchiveHostForSlug, isDashboardHost, clearArchiveHostCache } = await import("@/lib/archive-host-lookup");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveHost: "news.acme-letters.org", archiveEnabled: true } });
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), "acme-weekly");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $unset: { archiveHost: 1 } });
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), "acme-weekly", "still the cached answer");
	clearArchiveHostCache();
	assert.equal(await resolveArchiveSlug("news.acme-letters.org"), null);

	process.env.ARCHIVE_HOSTS = "legacy.example.org=birch-weekly";
	assert.equal(await resolveArchiveSlug("legacy.example.org"), "birch-weekly");
	assert.equal(await resolveArchiveHostForSlug("birch-weekly"), "legacy.example.org");

	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveHost: "news.acme-letters.org" } });
	assert.equal(await resolveArchiveHostForSlug("acme-weekly"), "news.acme-letters.org");
	assert.equal(isDashboardHost("mailcheap.test"), true);
	assert.equal(isDashboardHost("localhost:3000"), true);
	assert.equal(isDashboardHost("news.acme-letters.org"), false);
});

test("a newsletter needs a reply-to address, and a malformed one is refused", async () => {
	const { saveNewsletter } = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	assert.match((await saveNewsletter(null, settings(a, { replyTo: "" }))).error, /Reply-to is required/);
	assert.match((await saveNewsletter(null, settings(a, { replyTo: "not-an-email" }))).error, /Reply-to email is invalid/);
	assert.equal((await db.models.Newsletter.findById(a.newsletter._id)).replyTo, undefined, "nothing saved by the refused tries");
	assert.equal((await saveNewsletter(null, settings(a, { replyTo: "Info@Acme.test" }))).ok, true);
	assert.equal((await db.models.Newsletter.findById(a.newsletter._id)).replyTo, "info@acme.test");
});
