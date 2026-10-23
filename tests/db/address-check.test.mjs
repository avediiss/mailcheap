import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { loginAs, makeTenant, startDb } from "./helpers.mjs";

let db;
let a;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(async () => {
	await db.reset();
	process.env.ADDRESS_CHECK_DNS = "off";
	const { clearAddressCaches } = await import("@/lib/address-check");
	clearAddressCaches();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
});

const form = (fields) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
};
let ip = 0;
const fromNewAddress = () => globalThis.__testRequest.headers.set("x-forwarded-for", `10.2.0.${++ip}`);
const count = (email) => db.models.Contact.countDocuments({ email });

async function apiSignup(email) {
	const route = await import("@/app/api/v1/contacts/route");
	return route.POST(
		new Request("https://mailcheap.test/api/v1/contacts", {
			method: "POST",
			headers: { authorization: `Bearer ${a.apiKeySecret}`, "content-type": "application/json" },
			body: JSON.stringify({ newsletter: "acme-weekly", email }),
		})
	);
}

test("the public signup form refuses typos and throwaway inboxes, says why, and adds real addresses", async () => {
	const { subscribe } = await import("@/app/archive/actions");
	await db.models.Newsletter.updateOne({ _id: a.newsletter._id }, { $set: { archiveEnabled: true } });
	await loginAs(a.owner);
	fromNewAddress();
	const typo = await subscribe(null, form({ email: "jane@gmial.com", newsletter: a.newsletter.slug }));
	assert.match(typo.error, /Did you mean jane@gmail\.com\?/);
	assert.match((await subscribe(null, form({ email: "x@mailinator.com", newsletter: a.newsletter.slug }))).error, /Temporary email addresses/);
	assert.equal((await count("jane@gmial.com")) + (await count("x@mailinator.com")), 0, "nothing was stored");
	assert.equal((await subscribe(null, form({ email: "jane@gmail.com", newsletter: a.newsletter.slug }))).ok, true);
	assert.equal(await count("jane@gmail.com"), 1);
});

test("the API answers 422 with the reason and the fix, and still accepts good addresses", async () => {
	let response = await apiSignup("bob@hotmial.com");
	assert.equal(response.status, 422);
	assert.deepEqual(await response.json(), { error: "That looks like a typo. Did you mean bob@hotmail.com?", reason: "typo", suggestion: "hotmail.com" });
	response = await apiSignup("bob@guerrillamail.com");
	assert.equal(response.status, 422);
	assert.equal((await response.json()).reason, "disposable");
	assert.equal((await apiSignup("bob@acme-readers.io")).status, 201);
	assert.equal(await count("bob@hotmial.com"), 0);
});

test("someone already on the list is never turned away by a rule added later", async () => {
	await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "old@mailinator.com", status: "active", source: "test" });
	const response = await apiSignup("old@mailinator.com");
	assert.equal(response.status, 200, "the same person signing up again is fine");
});

test("the platform's blocklist stops a domain and its subdomains everywhere, and removing it lets it back", async () => {
	const { clearAddressCaches } = await import("@/lib/address-check");
	await db.models.BlockedDomain.create({ domain: "spam-source.test", reason: "bulk junk signups" });
	clearAddressCaches();
	let response = await apiSignup("a@spam-source.test");
	assert.equal(response.status, 422);
	assert.equal((await response.json()).reason, "blocked");
	assert.equal((await apiSignup("a@mail.spam-source.test")).status, 422);
	assert.equal((await apiSignup("a@not-spam-source.test")).status, 201);
	await db.models.BlockedDomain.deleteOne({ domain: "spam-source.test" });
	clearAddressCaches();
	assert.equal((await apiSignup("b@spam-source.test")).status, 201);
});

test("the DNS check is switched off by ADDRESS_CHECK_DNS=off, and big providers are never looked up", async () => {
	const { checkAddress } = await import("@/lib/address-check");
	// The lookup itself is tested with a fake resolver (address-quality.test.mjs); here only the switches, so no
	// test depends on the network.
	process.env.ADDRESS_CHECK_DNS = "on";
	assert.equal(await checkAddress("someone@gmail.com"), null, "big providers are never looked up");
	process.env.ADDRESS_CHECK_DNS = "off";
	assert.equal(await checkAddress("someone@no-such-domain-zq81.invalid"), null, "off means off");
});

test("adding one contact by hand explains what is wrong, and a CSV import drops the bad rows and counts them by reason", async () => {
	const { addContact, importContacts } = await import("@/app/(app)/contacts/actions");
	await loginAs(a.owner);
	assert.match((await addContact({ newsletterId: String(a.newsletter._id), email: "kim@gmial.com" })).error, /Did you mean kim@gmail\.com\?/);
	assert.equal((await addContact({ newsletterId: String(a.newsletter._id), email: "kim@gmail.com" })).created, true);

	const result = await importContacts({
		newsletterId: String(a.newsletter._id),
		rows: [
			{ email: "ok1@acme-readers.io", status: "active" },
			{ email: "ok2@gmail.com", status: "active" },
			{ email: "typo@gmial.com", status: "active" },
			{ email: "t2@yahooo.com", status: "active" },
			{ email: "temp@mailinator.com", status: "active" },
			{ email: "not an email", status: "active" },
			// Someone who left is kept even on a bad domain: the row exists to stop mail to them.
			{ email: "left@mailinator.com", status: "unsubscribed" },
		],
	});
	assert.deepEqual(result.rejected, { typo: 2, disposable: 1, blocked: 0, undeliverable: 0 });
	assert.equal(result.rejectedCount, 3);
	assert.equal(result.created, 3, "two good rows and the unsubscribe record");
	assert.equal(result.invalid, 1);
	assert.equal((await db.models.Contact.findOne({ email: "left@mailinator.com" })).status, "unsubscribed");
	assert.equal(await count("typo@gmial.com"), 0);
});
