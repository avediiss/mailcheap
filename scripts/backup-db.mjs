// Copies the whole database into plain files before something risky (like the workspace migration).
//
//   MONGODB_URI='mongodb+srv://...' node scripts/backup-db.mjs
//   MONGODB_URI='...' node scripts/backup-db.mjs --restore backups/2026-10-20T10-00-00
//
// A backup goes into ./backups/<date and time>/. It holds every subscriber's address: keep it private (the
// folder is ignored by git). Restore only works into an empty database.
import path from "node:path";
import mongoose from "mongoose";
import { backupDatabase, isDirectory, restoreDatabase } from "../lib/db-backup.js";

if (!process.env.MONGODB_URI) {
	console.error("MONGODB_URI is not set");
	process.exit(1);
}
const restoreIndex = process.argv.indexOf("--restore");

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
	const db = mongoose.connection.db;
	if (restoreIndex >= 0) {
		const directory = path.resolve(process.argv[restoreIndex + 1] ?? "");
		if (!(await isDirectory(directory))) throw new Error("Give the backup folder after --restore");
		const counts = await restoreDatabase(db, directory, { log: (line) => console.log(`- restored ${line}`) });
		console.log(`\nRestored ${Object.keys(counts).length} collections.`);
	} else {
		const directory = path.resolve("backups", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
		const counts = await backupDatabase(db, directory, { log: (line) => console.log(`- ${line}`) });
		const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
		console.log(`\nBacked up ${total} documents from ${Object.keys(counts).length} collections to:\n${directory}`);
	}
} catch (error) {
	console.error(`\nStopped: ${error.message}`);
	process.exitCode = 1;
} finally {
	await mongoose.disconnect();
}
