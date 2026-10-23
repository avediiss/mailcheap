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
	process.env.ADDRESS_CHECK_DNS = "off";
	const { clearAddressCaches } = await import("@/lib/address-check");
	clearAddressCaches();
	a = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	b = await makeTenant(db.models, { name: "Birch", slug: "birch" });
	await db.models.Contact.deleteMany({});
});

const id = (doc) => String(doc._id);
const rows = (count, make = (index) => ({ email: `p${index}@acme-readers.io`, status: "active" })) => Array.from({ length: count }, (_, index) => make(index));

async function actions() {
	return import("@/app/(app)/contacts/actions");
}

// The whole browser side: start, send the parts, finish.
async function upload(all, { newFields, fileName = "people.csv" } = {}) {
	const { startImport, uploadImportChunk, finishImport } = await actions();
	const started = await startImport({ newsletterId: id(a.newsletter), fileName, totalRows: all.length, newFields });
	assert.equal(started.ok, true, started.error);
	for (let index = 0; index * started.chunkRows < all.length; index++) {
		const result = await uploadImportChunk({ jobId: started.jobId, index, rows: all.slice(index * started.chunkRows, (index + 1) * started.chunkRows) });
		assert.equal(result.ok, true, result.error);
	}
	return { started, finished: await finishImport(started.jobId) };
}

test("a big file is uploaded in parts, queued, and added by the background job with a result and an email", async () => {
	await loginAs(a.owner);
	const { runImportJob } = await import("@/lib/import-jobs");
	const { started, finished } = await upload(rows(1300), { fileName: "list.csv" });
	assert.deepEqual(finished, { ok: true });
	let job = await db.models.ImportJob.findById(started.jobId);
	assert.equal(job.status, "queued");
	assert.equal(job.chunkCount, 3);
	assert.ok(globalThis.__qstashCalls.some(({ url, body }) => url.endsWith("/api/jobs/import") && body.jobId === started.jobId), "handed to the queue");

	assert.deepEqual(await runImportJob(started.jobId), { done: true });
	job = await db.models.ImportJob.findById(started.jobId);
	assert.equal(job.status, "done");
	assert.equal(job.created, 1300);
	assert.equal(job.processedRows, 1300);
	assert.ok(job.finishedAt);
	assert.equal(await db.models.Contact.countDocuments({ workspaceId: a.workspace._id }), 1300);
	assert.equal(await db.models.ImportChunk.countDocuments({ jobId: job._id }), 0, "the parts are gone");
	assert.ok(globalThis.__sentEmails.some(({ subject, to }) => /import finished/i.test(subject) && to === a.owner.email), "the owner is told");

	// Running it again does nothing and adds no one twice.
	assert.deepEqual(await runImportJob(started.jobId), { skipped: "not waiting" });
});

test("the file is checked: row counts, the newsletter, one import at a time, parts in order and not too large", async () => {
	await loginAs(a.owner);
	const { startImport, uploadImportChunk, finishImport } = await actions();
	assert.match((await startImport({ newsletterId: id(a.newsletter), totalRows: 0 })).error, /no rows/);
	assert.match((await startImport({ newsletterId: id(a.newsletter), totalRows: 250_001 })).error, /up to 250,000 rows/);
	assert.equal((await startImport({ newsletterId: id(b.newsletter), totalRows: 10 })).error, "Newsletter not found");
	assert.equal((await startImport({ newsletterId: "nope", totalRows: 10 })).error, "Newsletter not found");

	const first = await startImport({ newsletterId: id(a.newsletter), totalRows: 600 });
	assert.match((await startImport({ newsletterId: id(a.newsletter), totalRows: 10 })).error, /Another import is still going/);
	assert.equal((await uploadImportChunk({ jobId: first.jobId, index: 2, rows: rows(1) })).error, "Unexpected part of the file");
	assert.equal((await uploadImportChunk({ jobId: first.jobId, index: 0, rows: rows(501) })).error, "Too many rows in one part");
	assert.equal((await uploadImportChunk({ jobId: first.jobId, index: 0, rows: [] })).error, "Too many rows in one part");
	assert.match((await finishImport(first.jobId)).error, /didn't arrive/);

	// The same part twice is counted once, and a part missing still stops the finish.
	await uploadImportChunk({ jobId: first.jobId, index: 0, rows: rows(500) });
	await uploadImportChunk({ jobId: first.jobId, index: 0, rows: rows(500) });
	assert.equal((await db.models.ImportJob.findById(first.jobId)).uploadedChunks, 1);
	assert.match((await finishImport(first.jobId)).error, /didn't arrive/);
});

test("another workspace can't add to, finish or watch an import", async () => {
	await loginAs(a.owner);
	const { startImport } = await actions();
	const started = await startImport({ newsletterId: id(a.newsletter), totalRows: 10 });
	await loginAs(b.owner);
	const { uploadImportChunk, finishImport, getImportProgress } = await actions();
	assert.match((await uploadImportChunk({ jobId: started.jobId, index: 0, rows: rows(10) })).error, /isn't accepting rows/);
	assert.match((await finishImport(started.jobId)).error, /didn't arrive/);
	assert.equal(await getImportProgress(), null);
});

test("the contact limit, address checks and bad rows are applied to every part and counted in the result", async () => {
	await db.models.Workspace.updateOne({ _id: a.workspace._id }, { $set: { limits: { contacts: 5, emailsPerMonth: null, newsletters: null } } });
	await loginAs(a.owner);
	const { runImportJob } = await import("@/lib/import-jobs");
	const all = [
		{ email: "typo@gmial.com", status: "active" },
		{ email: "temp@mailinator.com", status: "active" },
		{ email: "left@mailinator.com", status: "unsubscribed" },
		{ email: "not an email", status: "active" },
		...rows(10),
	];
	const { started } = await upload(all);
	await runImportJob(started.jobId);
	const job = await db.models.ImportJob.findById(started.jobId);
	assert.equal(job.status, "done");
	assert.deepEqual({ typo: job.rejected.typo, disposable: job.rejected.disposable }, { typo: 1, disposable: 1 });
	assert.equal(job.invalid, 1);
	assert.equal(job.created, 6, "5 within the limit, plus the unsubscribe record, which takes no room");
	assert.equal(job.skippedOverLimit, 5);
	assert.equal(await db.models.Contact.countDocuments({ workspaceId: a.workspace._id, status: "active" }), 5);
});

test("columns kept as custom fields: typed, new contacts get them, existing ones only fill gaps, and text is never read as a reference", async () => {
	await loginAs(a.owner);
	const { runImportJob } = await import("@/lib/import-jobs");
	await db.models.ContactField.insertMany([
		{ workspaceId: a.workspace._id, key: "seats", label: "Seats", type: "number" },
		{ workspaceId: a.workspace._id, key: "renews", label: "Renews", type: "date" },
	]);
	await db.models.Contact.create({ workspaceId: a.workspace._id, newsletterId: a.newsletter._id, email: "old@acme-readers.io", status: "active", fields: { seats: 99 } });
	const all = [
		{ email: "new@acme-readers.io", status: "active", fields: { seats: "12", renews: "2026-12-01", company: "$100 & {{x}}" } },
		{ email: "old@acme-readers.io", status: "active", fields: { seats: "5", renews: "2027-01-01" } },
		{ email: "bad@acme-readers.io", status: "active", fields: { seats: "lots", renews: "someday" } },
	];
	const { started } = await upload(all, { newFields: [{ header: "Company", label: "Company" }] });
	assert.deepEqual(started.fields, [{ header: "Company", key: "company" }]);
	await runImportJob(started.jobId);

	const get = (email) => db.models.Contact.findOne({ email }).lean();
	assert.deepEqual((await get("new@acme-readers.io")).fields, { seats: 12, renews: "2026-12-01", company: "$100 & {{x}}" });
	assert.deepEqual((await get("old@acme-readers.io")).fields, { seats: 99, renews: "2027-01-01" }, "99 was already there");
	assert.equal((await get("bad@acme-readers.io")).fields, undefined, "bad values are left out, the contact is still added");
	assert.equal((await db.models.ImportJob.findById(started.jobId)).fieldProblems, 2);
	assert.ok(await db.models.ContactField.exists({ workspaceId: a.workspace._id, key: "company", type: "text" }), "the new field was created");
});

test("a refused import creates no fields, and a bad new field name stops it before anything starts", async () => {
	await loginAs(a.owner);
	const { startImport } = await actions();
	const refused = await startImport({ newsletterId: id(b.newsletter), totalRows: 5, newFields: [{ header: "Company", label: "Company" }] });
	assert.equal(refused.error, "Newsletter not found");
	assert.equal(await db.models.ContactField.countDocuments(), 0);
	assert.match((await startImport({ newsletterId: id(a.newsletter), totalRows: 5, newFields: [{ header: "E", label: "Email" }] })).error, /already used for something else/);
	assert.equal(await db.models.ImportJob.countDocuments(), 0);
});

test("a part that went missing fails the import with a reason instead of adding around the hole", async () => {
	await loginAs(a.owner);
	const { runImportJob } = await import("@/lib/import-jobs");
	const { started } = await upload(rows(1100));
	await db.models.ImportChunk.deleteOne({ jobId: started.jobId, index: 1 });
	assert.deepEqual(await runImportJob(started.jobId), { failed: true });
	const job = await db.models.ImportJob.findById(started.jobId);
	assert.equal(job.status, "failed");
	assert.match(job.error, /Part 2 of the file was lost/);
	assert.equal(job.processedChunks, 1, "the part before the hole was added");
	assert.equal(await db.models.ImportChunk.countDocuments({ jobId: job._id }), 0);
	// A new import can start now.
	const { startImport } = await actions();
	assert.equal((await startImport({ newsletterId: id(a.newsletter), totalRows: 5 })).ok, true);
});

test("progress shows the import under way, then its result for a day", async () => {
	await loginAs(a.owner);
	const { getImportProgress } = await actions();
	const { runImportJob } = await import("@/lib/import-jobs");
	assert.equal(await getImportProgress(), null);
	const { started } = await upload(rows(700), { fileName: "big.csv" });
	let progress = await getImportProgress();
	assert.equal(progress.status, "queued");
	assert.equal(progress.totalRows, 700);
	await runImportJob(started.jobId);
	progress = await getImportProgress();
	assert.equal(progress.status, "done");
	assert.equal(progress.created, 700);
	assert.equal(progress.fileName, "big.csv");

	await db.models.ImportJob.updateOne({ _id: started.jobId }, { $set: { finishedAt: new Date(Date.now() - 2 * 86_400_000) } });
	assert.equal(await getImportProgress(), null, "a result older than a day is no longer shown");
});
