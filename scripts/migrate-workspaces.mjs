// Moves an existing single-owner Mailcheap install to workspaces. See lib/migrate-workspaces.js.
//
//   MONGODB_URI=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/migrate-workspaces.mjs --dry-run
//   MONGODB_URI=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/migrate-workspaces.mjs --yes
//
// Take a backup first (an Atlas snapshot or mongodump). Run it BEFORE deploying the workspace version:
// the new code only shows data that has a workspace.
import mongoose from "mongoose";
import { migrateWorkspaces } from "../lib/migrate-workspaces.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
};

if (!process.env.MONGODB_URI) {
	console.error("MONGODB_URI is not set");
	process.exit(1);
}
const dryRun = !flag("yes");
if (dryRun && !flag("dry-run")) console.log("No --yes given: this is a dry run, nothing is written.\n");

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
try {
	const summary = await migrateWorkspaces({
		dryRun,
		workspaceName: option("name") ?? "Avedis",
		workspaceSlug: option("slug") ?? "avedis",
		adminEmail: process.env.ADMIN_EMAIL,
		adminPassword: process.env.ADMIN_PASSWORD,
		assignSuppressions: flag("assign-suppressions"),
		log: (line) => console.log(`- ${line}`),
	});
	if (summary.remaining) {
		console.log("\nStill without a workspace (should all be 0):", JSON.stringify(summary.remaining));
	}
	console.log(dryRun ? "\nDry run finished. Run again with --yes to apply." : "\nDone.");
} finally {
	await mongoose.disconnect();
}
