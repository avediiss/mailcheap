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
	const { clearSendPlanCache } = await import("@/lib/send-plan-server");
	clearSendPlanCache();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	await db.models.Workspace.updateMany({}, { $set: { sendingTrust: { isTrusted: true } } });
});

const id = (doc) => String(doc._id);

async function createField(label, type = "text") {
	const { createContactField } = await import("@/app/(app)/contacts/actions");
	return createContactField({ label, type });
}

test("a workspace defines its own fields: a name becomes a merge tag, with checks, and another workspace never sees them", async () => {
	await loginAs(a.owner);
	assert.deepEqual(await createField("Renewal date", "date"), { ok: true, field: { key: "renewal_date", label: "Renewal date", type: "date" } });
	assert.equal((await createField("Plan")).ok, true);
	assert.match((await createField("plan")).error, /already a field called plan/);
	assert.match((await createField("Email")).error, /already used for something else/);
	assert.match((await createField("", "text")).error, /Give the field a name/);
	assert.match((await createField("Seats", "money")).error, /Pick a type/);

	const { listContactFields } = await import("@/lib/contact-fields-server");
	assert.deepEqual((await listContactFields(a.workspace._id)).map(({ key }) => key), ["renewal_date", "plan"]);
	assert.deepEqual(await listContactFields(b.workspace._id), []);
	await loginAs(b.owner);
	assert.equal((await createField("Plan")).ok, true, "the same name in another workspace is fine");
});

test("a workspace is limited to 25 fields", async () => {
	await loginAs(a.owner);
	for (let index = 0; index < 25; index++) assert.equal((await createField(`Field ${String.fromCharCode(97 + (index % 26))}${"x".repeat(Math.floor(index / 26))}${index}`)).ok, true, `field ${index}`);
	assert.match((await createField("One too many")).error, /25 fields/);
});

test("editing a contact sets, changes and clears field values by type, refusing nonsense and unknown fields", async () => {
	const { updateContact } = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);
	await createField("Plan");
	await createField("Seats", "number");
	await createField("Renews", "date");
	const edit = (fields, extra = {}) => updateContact({ id: id(a.contact), firstName: "Dana", tags: "vip", fields, ...extra });

	assert.deepEqual(await edit({ plan: "Pro", seats: "12", renews: "2026-12-01" }), { ok: true });
	let contact = await db.models.Contact.findById(a.contact._id).lean();
	assert.deepEqual(contact.fields, { plan: "Pro", seats: 12, renews: "2026-12-01" });
	assert.equal(contact.firstName, "Dana");

	assert.deepEqual(await edit({ plan: "", seats: "20" }), { ok: true });
	contact = await db.models.Contact.findById(a.contact._id).lean();
	assert.deepEqual(contact.fields, { seats: 20, renews: "2026-12-01" }, "empty clears, untouched keys stay");

	assert.match((await edit({ seats: "many" })).error, /Seats: Enter a number/);
	assert.match((await edit({ renews: "someday" })).error, /Renews: Enter a date/);
	assert.match((await edit({ colour: "red" })).error, /Unknown field: colour/);
	assert.deepEqual((await db.models.Contact.findById(a.contact._id).lean()).fields, { seats: 20, renews: "2026-12-01" }, "refused edits changed nothing");

	// Another workspace's contact can't be edited through this one.
	assert.equal((await updateContact({ id: id(b.contact), fields: { seats: "1" } })).error, "Contact not found");
	assert.equal((await db.models.Contact.findById(b.contact._id).lean()).fields, undefined);
});

test("removing a field removes its value from every contact", async () => {
	const { removeContactField } = await import("@/app/(app)/contacts/actions");
	const { updateContact } = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);
	await createField("Plan");
	await createField("Seats", "number");
	await updateContact({ id: id(a.contact), fields: { plan: "Pro", seats: "3" } });
	assert.deepEqual(await removeContactField("plan"), { ok: true });
	assert.deepEqual((await db.models.Contact.findById(a.contact._id).lean()).fields, { seats: 3 });
	assert.equal((await removeContactField("plan")).error, "Field not found");
});

async function apiSignup(secret, body) {
	const route = await import("@/app/api/v1/contacts/route");
	return route.POST(
		new Request("https://mailcheap.test/api/v1/contacts", {
			method: "POST",
			headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		})
	);
}

test("the API takes field values with a signup: new contacts get them, existing ones only fill gaps, mistakes are a 400", async () => {
	await db.models.ContactField.insertMany([
		{ workspaceId: a.workspace._id, key: "plan", label: "Plan", type: "text" },
		{ workspaceId: a.workspace._id, key: "seats", label: "Seats", type: "number" },
	]);
	let response = await apiSignup(a.apiKeySecret, { newsletter: "acme-weekly", email: "new@acme-readers.io", fields: { plan: "Pro", seats: 4 } });
	assert.equal(response.status, 201);
	let contact = await db.models.Contact.findOne({ email: "new@acme-readers.io" }).lean();
	assert.deepEqual(contact.fields, { plan: "Pro", seats: 4 });

	// Signing up again with other values keeps what is there and fills what was missing.
	await db.models.Contact.updateOne({ _id: contact._id }, { $unset: { "fields.seats": 1 } });
	response = await apiSignup(a.apiKeySecret, { newsletter: "acme-weekly", email: "new@acme-readers.io", fields: { plan: "Free", seats: 9 } });
	assert.equal(response.status, 200);
	contact = await db.models.Contact.findOne({ email: "new@acme-readers.io" }).lean();
	assert.deepEqual(contact.fields, { plan: "Pro", seats: 9 });

	response = await apiSignup(a.apiKeySecret, { newsletter: "acme-weekly", email: "x@acme-readers.io", fields: { plans: "typo" } });
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error, "Unknown field: plans");
	assert.equal((await apiSignup(a.apiKeySecret, { newsletter: "acme-weekly", email: "x@acme-readers.io", fields: { seats: "lots" } })).status, 400);
	assert.equal((await apiSignup(a.apiKeySecret, { newsletter: "acme-weekly", email: "x@acme-readers.io", fields: "plan=Pro" })).status, 400);
	assert.equal(await db.models.Contact.countDocuments({ email: "x@acme-readers.io" }), 0, "a refused signup adds nobody");
	// Birch's fields aren't Acme's: the same key is unknown to a key from another workspace.
	assert.equal((await apiSignup(b.apiKeySecret, { newsletter: "birch-weekly", email: "y@birch-readers.io", fields: { plan: "Pro" } })).status, 400);
});

test("an email fills in a contact's fields, uses the fallback when there is no value, and leaves undefined tags as written", async () => {
	await db.models.ContactField.insertMany([
		{ workspaceId: a.workspace._id, key: "plan", label: "Plan", type: "text" },
		{ workspaceId: a.workspace._id, key: "seats", label: "Seats", type: "number" },
		{ workspaceId: a.workspace._id, key: "renews", label: "Renews", type: "date" },
		{ workspaceId: a.workspace._id, key: "company", label: "Company", type: "text" },
	]);
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { firstName: "Dana", lastSentAt: new Date(), fields: { plan: "Pro <b>", seats: 1250, renews: "2026-12-01" } } });
	await db.models.Campaign.updateOne(
		{ _id: a.campaign._id },
		{ $set: { status: "sending", subject: "{{first_name}}, your {{plan}} plan", markdown: "Seats: {{seats}}. Renews {{renews}}. At {{company|your company}}. Odd tag: {{frist_name}}. Missing: [{{company}}]." } }
	);
	const message = await db.models.Message.create({ kind: "campaign", workspaceId: a.workspace._id, campaignId: a.campaign._id, newsletterId: a.newsletter._id, contactId: a.contact._id, email: a.contact.email, status: "queued" });
	const { sendMessageBatch } = await import("@/lib/sending");
	globalThis.__sentEmails.length = 0;
	const result = await sendMessageBatch([id(message)]);
	assert.equal(result.sent, 1);
	const email = globalThis.__sentEmails.find(({ to }) => to === a.contact.email);
	assert.equal(email.subject, "Dana, your Pro <b> plan", "the subject is text, not HTML");
	assert.match(email.html, /Seats: 1,250\./);
	assert.match(email.html, /Renews December 1, 2026\./);
	assert.match(email.html, /At your company\./);
	assert.match(email.html, /Odd tag: \{\{frist_name\}\}\./);
	assert.match(email.html, /Missing: \[\]\./);
	assert.doesNotMatch(email.html, /Pro <b>/, "markup in a value is escaped in the HTML");
	assert.match(email.text, /Seats: 1,250/);
});

test("the contacts export has a column for each field", async () => {
	const { GET } = await import("@/app/api/contacts-export/route");
	await db.models.ContactField.insertMany([
		{ workspaceId: a.workspace._id, key: "plan", label: "Plan", type: "text" },
		{ workspaceId: a.workspace._id, key: "seats", label: "Seats", type: "number" },
	]);
	await db.models.Contact.updateOne({ _id: a.contact._id }, { $set: { fields: { plan: "=Pro", seats: 5 } } });
	await loginAs(a.owner);
	const text = await (await GET(new Request("https://mailcheap.test/api/contacts-export"))).text();
	const [header, line] = text.replace(/^﻿/, "").split("\r\n");
	assert.match(header, /,last_open_at,plan,seats$/);
	assert.match(line, /,'=Pro,5$/, "a value that starts with = is quoted so a spreadsheet won't run it");
});
