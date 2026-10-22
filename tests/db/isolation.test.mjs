import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { catching, loginAs, makeTenant, resetRequest, startDb } from "./helpers.mjs";

// The rule under test: a person in workspace A can't read, change or send anything of workspace B, by any
// path (pages' queries, server actions, the CSV export, the public API), and gets "not found", never "forbidden".

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

const id = (document) => String(document._id);

test("contact actions can't touch another workspace's contacts or newsletters", async () => {
	const actions = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);

	assert.deepEqual(await actions.deleteContact(id(b.contact)), { error: "Contact not found" });
	assert.ok(await db.models.Contact.exists({ _id: b.contact._id }), "B's contact is still there");

	assert.deepEqual(await actions.updateContact({ id: id(b.contact), firstName: "Hacked", tags: ["x"] }), { error: "Contact not found" });
	assert.equal((await db.models.Contact.findById(b.contact._id)).firstName, undefined);

	assert.deepEqual(await actions.setContactStatus(id(b.contact), "unsubscribed"), { error: "Status cannot change" });
	assert.equal((await db.models.Contact.findById(b.contact._id)).status, "active");

	assert.deepEqual(await actions.importContacts({ newsletterId: id(b.newsletter), rows: [{ email: "planted@x.test", status: "active" }] }), { error: "Newsletter not found" });
	assert.deepEqual(await actions.addContact({ newsletterId: id(b.newsletter), email: "planted@x.test" }), { error: "Newsletter not found" });
	assert.equal(await db.models.Contact.countDocuments({ email: "planted@x.test" }), 0, "nothing planted in B's list");
});

test("contact actions do work inside the person's own workspace, and stamp its workspaceId", async () => {
	const actions = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);

	const added = await actions.addContact({ newsletterId: id(a.newsletter), email: "New@Example.com", firstName: "Dana Smith", tags: ["VIP"] });
	assert.equal(added.created, true);
	const contact = await db.models.Contact.findOne({ email: "new@example.com" });
	assert.equal(String(contact.workspaceId), id(a.workspace));
	assert.equal(contact.firstName, "Dana");
	assert.deepEqual([...contact.tags], ["vip"]);

	const imported = await actions.importContacts({ newsletterId: id(a.newsletter), rows: [{ email: "csv@example.com", status: "active" }] });
	assert.equal(imported.created, 1);
	assert.equal(String((await db.models.Contact.findOne({ email: "csv@example.com" })).workspaceId), id(a.workspace));

	assert.deepEqual(await actions.updateContact({ id: id(a.contact), firstName: "Ana" }), { ok: true });
	assert.deepEqual(await actions.deleteContact(id(a.contact)), { ok: true });
	assert.equal(await db.models.Contact.countDocuments({ _id: a.contact._id }), 0);
});

test("deleting a contact erases only this workspace's trace of that address", async () => {
	const actions = await import("@/app/(app)/contacts/actions");
	const shared = "shared@example.com";
	const inA = await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: shared, status: "active" });
	const inB = await db.models.Contact.create({ workspaceId: b.workspace._id, newsletterId: b.newsletter._id, email: shared, status: "active" });
	await db.models.Event.create({ workspaceId: a.workspace._id, type: "Bounce", email: shared });
	await db.models.Event.create({ workspaceId: b.workspace._id, type: "Bounce", email: shared });

	await loginAs(a.owner);
	assert.deepEqual(await actions.deleteContact(id(inA)), { ok: true });
	assert.ok(await db.models.Contact.exists({ _id: inB._id }), "B still has the contact");
	assert.equal(await db.models.Event.countDocuments({ workspaceId: b.workspace._id, email: shared }), 1, "B's events keep the address");
	assert.equal(await db.models.Event.countDocuments({ workspaceId: a.workspace._id, email: shared }), 0, "A's are anonymized");
});

test("campaign actions can't read, change, copy, send or discard another workspace's campaigns", async () => {
	const actions = await import("@/app/(app)/campaigns/actions");
	await loginAs(a.owner);
	const notFound = { error: "Campaign not found" };

	assert.deepEqual(await actions.saveCampaign(id(b.campaign), { subject: "Hacked", body: "<p>x</p>" }), notFound);
	assert.equal((await db.models.Campaign.findById(b.campaign._id)).subject, "Birch issue");
	assert.deepEqual(await actions.discardCampaign(id(b.campaign)), notFound);
	assert.equal((await db.models.Campaign.findById(b.campaign._id)).status, "draft");
	assert.deepEqual(await actions.sendCampaign(id(b.campaign)), notFound);
	assert.deepEqual(await actions.scheduleCampaign(id(b.campaign), { scheduledAt: new Date(Date.now() + 3600_000).toISOString() }), notFound);
	assert.deepEqual(await actions.sendTestCampaign(id(b.campaign)), notFound);
	assert.deepEqual(await actions.setCampaignAudience(id(b.campaign), { tag: "x" }), notFound);
	assert.deepEqual(await actions.updateArchiveSlug(id(b.campaign), "stolen"), notFound);
	assert.deepEqual(await actions.previewCleanup(id(b.campaign)), notFound);
	assert.equal((await catching(() => actions.duplicateCampaign(id(b.campaign)))).value?.error, "Campaign not found");
	assert.equal(await db.models.Campaign.countDocuments({ workspaceId: a.workspace._id }), 1, "no copy of B's campaign appeared in A");
	assert.deepEqual(await actions.createCampaign(id(b.newsletter)), { error: "Newsletter not found" });
	assert.equal(await db.models.Campaign.countDocuments({ newsletterId: b.newsletter._id }), 1);
	assert.equal(await db.emails?.length ?? 0, 0);
});

test("campaigns made in a workspace carry its workspaceId, including copies", async () => {
	const actions = await import("@/app/(app)/campaigns/actions");
	await loginAs(a.owner);

	const created = await catching(() => actions.createCampaign(id(a.newsletter)));
	assert.match(created.redirectTo, /^\/campaigns\/[0-9a-f]{24}$/);
	const campaign = await db.models.Campaign.findById(created.redirectTo.split("/").pop());
	assert.equal(String(campaign.workspaceId), id(a.workspace));

	const copied = await catching(() => actions.duplicateCampaign(id(a.campaign)));
	const copy = await db.models.Campaign.findById(copied.redirectTo.split("/").pop());
	assert.equal(String(copy.workspaceId), id(a.workspace));
	assert.deepEqual(await actions.saveCampaign(id(a.campaign), { subject: "Edited", body: "<p>hi</p>" }), { ok: true });
});

test("newsletter settings can't be changed across workspaces, and can't use another workspace's domain", async () => {
	const actions = await import("@/app/(app)/newsletters/actions");
	await loginAs(a.owner);
	const form = (fields) => {
		const data = new FormData();
		for (const [key, value] of Object.entries({ name: "Edited", slug: "edited", fromEmail: `hi@${a.domain}`, replyTo: `info@${a.domain}`, ...fields })) data.set(key, value);
		return data;
	};

	assert.deepEqual(await actions.saveNewsletter(null, form({ id: id(b.newsletter), slug: "birch-weekly", fromEmail: `hi@${b.domain}` })), { error: "Newsletter not found" });
	assert.equal((await db.models.Newsletter.findById(b.newsletter._id)).name, "Birch weekly");

	const offDomain = await actions.saveNewsletter(null, form({ id: id(a.newsletter), slug: "acme-weekly", fromEmail: `hi@${b.domain}` }));
	assert.match(offDomain.error, /must be on one of your domains: acme\.test/);

	const created = await catching(() => actions.saveNewsletter(null, form({ slug: "acme-second" })));
	assert.match(created.redirectTo, /^\/newsletters\//);
	const second = await db.models.Newsletter.findOne({ slug: "acme-second" });
	assert.equal(String(second.workspaceId), id(a.workspace), "the new newsletter belongs to the creator's workspace");

	assert.deepEqual(await actions.sendWelcomeTest(id(b.newsletter)), { error: "Newsletter not found" });
});

test("a workspace with no domain can't pick a from address at all", async () => {
	const actions = await import("@/app/(app)/newsletters/actions");
	await db.models.Domain.deleteMany({ workspaceId: a.workspace._id });
	await loginAs(a.owner);
	const data = new FormData();
	for (const [key, value] of Object.entries({ name: "N", slug: "n-n", fromEmail: "hi@acme.test", replyTo: "info@acme.test" })) data.set(key, value);
	assert.match((await actions.saveNewsletter(null, data)).error, /Add a sending domain/);
});

test("API keys: owners only, scoped, and another workspace's key can't be revoked", async () => {
	const actions = await import("@/app/(app)/api-keys/actions");

	await loginAs(a.editor);
	const form = new FormData();
	form.set("name", "Sneaky");
	assert.match((await actions.createApiKey(null, form)).error, /Only a workspace owner/);
	assert.match((await actions.revokeApiKey(id(a.apiKey))).error, /Only a workspace owner/);

	await loginAs(a.owner);
	assert.deepEqual(await actions.revokeApiKey(id(b.apiKey)), { ok: true }, "reports ok, as for any unknown key");
	assert.equal((await db.models.ApiKey.findById(b.apiKey._id)).revokedAt, undefined, "but B's key is untouched");

	const created = await actions.createApiKey(null, form);
	assert.match(created.key, /^/);
	const key = await db.models.ApiKey.findOne({ name: "Sneaky" });
	assert.equal(String(key.workspaceId), id(a.workspace));
	await actions.revokeApiKey(id(a.apiKey));
	assert.ok((await db.models.ApiKey.findById(a.apiKey._id)).revokedAt);
});

test("the CSV export contains only the signed-in workspace's contacts", async () => {
	const { GET } = await import("@/app/api/contacts-export/route");
	await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "a2@example.com", status: "active" });

	await loginAs(a.owner);
	let response = await GET(new Request("https://mailcheap.test/api/contacts-export"));
	let csv = await response.text();
	assert.ok(csv.includes(a.contact.email) && csv.includes("a2@example.com"));
	assert.ok(!csv.includes(b.contact.email), "B's address is not in A's export");

	// Naming B's newsletter in the address changes nothing: the workspace filter still applies.
	response = await GET(new Request(`https://mailcheap.test/api/contacts-export?newsletter=${id(b.newsletter)}`));
	csv = await response.text();
	assert.ok(!csv.includes(b.contact.email));

	resetRequest();
	assert.equal((await GET(new Request("https://mailcheap.test/api/contacts-export"))).status, 401);
});

test("the public API: a key reaches only its own workspace's newsletters", async () => {
	const contactsRoute = await import("@/app/api/v1/contacts/route");
	const campaignsRoute = await import("@/app/api/v1/campaigns/route");
	const call = (route, method, key, body, search = "") =>
		route[method](
			new Request(`https://mailcheap.test/api/v1/x${search}`, {
				method,
				headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
				...(body && { body: JSON.stringify(body) }),
			})
		);

	// A's key, B's newsletter slug: indistinguishable from a slug that doesn't exist.
	let response = await call(contactsRoute, "POST", a.apiKeySecret, { newsletter: "birch-weekly", email: "planted@x.test" });
	assert.equal(response.status, 404);
	assert.equal(await db.models.Contact.countDocuments({ email: "planted@x.test" }), 0);
	response = await call(contactsRoute, "POST", a.apiKeySecret, { newsletter: "no-such-newsletter", email: "planted@x.test" });
	assert.equal(response.status, 404);

	response = await call(campaignsRoute, "GET", a.apiKeySecret, null, "?newsletter=birch-weekly");
	assert.equal(response.status, 404);
	response = await call(campaignsRoute, "POST", a.apiKeySecret, { newsletter: "birch-weekly", subject: "Planted", markdown: "x" });
	assert.equal(response.status, 404);
	assert.equal(await db.models.Campaign.countDocuments({ subject: "Planted" }), 0);

	// Its own newsletter works, and the contact and draft are stamped with the key's workspace.
	response = await call(contactsRoute, "POST", a.apiKeySecret, { newsletter: "acme-weekly", email: "reader@example.com", firstName: "Dana" });
	assert.equal(response.status, 201);
	const contact = await db.models.Contact.findOne({ email: "reader@example.com" });
	assert.equal(String(contact.workspaceId), id(a.workspace));
	response = await call(campaignsRoute, "POST", a.apiKeySecret, { newsletter: "acme-weekly", subject: "From the API", markdown: "hello" });
	assert.equal(response.status, 201);
	assert.equal(String((await db.models.Campaign.findOne({ subject: "From the API" })).workspaceId), id(a.workspace));
	response = await call(campaignsRoute, "GET", a.apiKeySecret, null, "?newsletter=acme-weekly");
	assert.equal(response.status, 200);

	// And B's key works for B.
	response = await call(contactsRoute, "POST", b.apiKeySecret, { newsletter: "birch-weekly", email: "reader@example.com" });
	assert.equal(response.status, 201);
	assert.equal(await db.models.Contact.countDocuments({ email: "reader@example.com" }), 2, "the same address can be in two workspaces");

	// Revoked keys, unknown keys and keys with no workspace reach nothing.
	await db.models.ApiKey.updateOne({ _id: a.apiKey._id }, { $set: { revokedAt: new Date() } });
	assert.equal((await call(contactsRoute, "POST", a.apiKeySecret, { newsletter: "acme-weekly", email: "x@x.test" })).status, 401);
	assert.equal((await call(contactsRoute, "POST", "not-a-key", { newsletter: "acme-weekly", email: "x@x.test" })).status, 401);
	await db.models.ApiKey.collection.updateOne({ _id: b.apiKey._id }, { $unset: { workspaceId: 1 } });
	assert.equal((await call(contactsRoute, "POST", b.apiKeySecret, { newsletter: "birch-weekly", email: "x@x.test" })).status, 401);
});

test("a suspended workspace takes no API calls and no public signups", async () => {
	const contactsRoute = await import("@/app/api/v1/contacts/route");
	const archive = await import("@/app/archive/actions");
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { status: "suspended" } });
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveEnabled: true } });

	const response = await contactsRoute.POST(
		new Request("https://mailcheap.test/api/v1/contacts", {
			method: "POST",
			headers: { authorization: `Bearer ${a.apiKeySecret}`, "content-type": "application/json" },
			body: JSON.stringify({ newsletter: "acme-weekly", email: "x@example.com" }),
		})
	);
	assert.equal(response.status, 403);

	const form = new FormData();
	form.set("email", "x@example.com");
	form.set("newsletter", "acme-weekly");
	const result = await archive.subscribe?.(null, form);
	if (result) assert.match(result.error, /not taking signups/);
	assert.equal(await db.models.Contact.countDocuments({ email: "x@example.com" }), 0);
});
