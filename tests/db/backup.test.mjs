import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { ObjectId } from "mongodb";
import { makeTenant, startDb } from "./helpers.mjs";

let db;
before(async () => {
	db = await startDb();
});
after(() => db.stop());
beforeEach(() => db.reset());

test("a backup gives back exactly the same data: ids, dates and nested fields", async () => {
	const { backupDatabase, restoreDatabase } = await import("@/lib/db-backup");
	const mongoose = (await import("mongoose")).default;
	const tenant = await makeTenant(db.models, { name: "Acme", slug: "acme" });
	await db.models.Contact.updateOne({ _id: tenant.contact._id }, { $set: { tags: ["vip"], firstName: "Dana", "stats.opens": 3, lastOpenAt: new Date("2026-10-01T10:00:00.000Z") } });
	const before = await db.models.Contact.collection.findOne({ _id: tenant.contact._id });

	const directory = await mkdtemp(path.join(tmpdir(), "mailcheap-backup-"));
	const counts = await backupDatabase(mongoose.connection.db, directory);
	assert.equal(counts.contacts, 1);
	assert.ok((await readdir(directory)).includes("contacts.ndjson"));
	const lines = (await readFile(path.join(directory, "contacts.ndjson"), "utf8")).trim().split("\n");
	assert.equal(lines.length, 1, "one document per line");
	assert.doesNotThrow(() => JSON.parse(lines[0]), "each line is valid JSON");

	await db.reset();
	assert.equal(await db.models.Contact.countDocuments(), 0);
	const restored = await restoreDatabase(mongoose.connection.db, directory);
	assert.equal(restored.contacts, 1);

	const after = await db.models.Contact.collection.findOne({ _id: tenant.contact._id });
	assert.ok(after._id instanceof ObjectId, "ids stay ids");
	assert.ok(after.workspaceId instanceof ObjectId);
	assert.ok(after.lastOpenAt instanceof Date, "dates stay dates");
	assert.deepEqual(after, before);
	assert.equal(await db.models.Workspace.countDocuments(), 1);
	assert.equal(await db.models.Newsletter.countDocuments(), 1);
});

test("a restore never mixes into a database that already has data", async () => {
	const { backupDatabase, restoreDatabase } = await import("@/lib/db-backup");
	const mongoose = (await import("mongoose")).default;
	await makeTenant(db.models, { name: "Acme", slug: "acme" });
	const directory = await mkdtemp(path.join(tmpdir(), "mailcheap-backup-"));
	await backupDatabase(mongoose.connection.db, directory);
	await assert.rejects(restoreDatabase(mongoose.connection.db, directory), /already has documents/);
});
