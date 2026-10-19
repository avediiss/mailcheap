import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { EJSON } from "bson";

// A plain-files copy of the whole database, one file per collection, one document per line. It keeps
// ObjectIds and dates exactly (Extended JSON), so a restore gives back the same data. Used before risky changes
// such as the workspace migration. The files hold every subscriber's address: keep them private.

const SKIP_COLLECTIONS = /^system\./;

export async function backupDatabase(db, directory, { log = () => {} } = {}) {
	await mkdir(directory, { recursive: true });
	const collections = (await db.listCollections().toArray()).map(({ name }) => name).filter((name) => !SKIP_COLLECTIONS.test(name));
	const counts = {};
	for (const name of collections) {
		const file = path.join(directory, `${name}.ndjson`);
		const out = createWriteStream(file);
		let count = 0;
		for await (const document of db.collection(name).find({})) {
			if (!out.write(`${EJSON.stringify(document, { relaxed: false })}\n`)) await new Promise((resolve) => out.once("drain", resolve));
			count++;
		}
		await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
		counts[name] = count;
		log(`${name}: ${count}`);
	}
	return counts;
}

async function readLines(file, onDocument) {
	const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	for await (const line of lines) if (line.trim()) await onDocument(EJSON.parse(line, { relaxed: false }));
}

// Puts a backup back. Refuses a collection that already has documents, so a restore can't overwrite or mix
// with live data: restore into an empty database, or drop the collection first.
export async function restoreDatabase(db, directory, { log = () => {} } = {}) {
	const files = (await readdir(directory)).filter((file) => file.endsWith(".ndjson"));
	const counts = {};
	for (const file of files) {
		const name = file.replace(/\.ndjson$/, "");
		const collection = db.collection(name);
		if ((await collection.estimatedDocumentCount()) > 0) throw new Error(`${name} already has documents. Restore into an empty database.`);
		let batch = [];
		let count = 0;
		const flush = async () => {
			if (batch.length === 0) return;
			await collection.insertMany(batch, { ordered: false });
			batch = [];
		};
		await readLines(path.join(directory, file), async (document) => {
			batch.push(document);
			count++;
			if (batch.length >= 500) await flush();
		});
		await flush();
		counts[name] = count;
		log(`${name}: ${count}`);
	}
	return counts;
}

export async function isDirectory(target) {
	return stat(target).then((info) => info.isDirectory(), () => false);
}
