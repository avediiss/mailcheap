// Runs one radar scan by hand, against a real product and the real Hacker News, and prints what it would
// have put in the founder's queue.
//
//   npm run dev:gtm-radar -- https://plausible.io
//   npm run dev:gtm-radar -- --days 30 https://plausible.io
//
// It reads the site and extracts a profile exactly as onboarding would, searches on that profile's own
// keywords, applies the same filter the scheduled scan applies, and scores what survives. Two kinds of AI
// call: one for the profile, then one per batch of ten posts.
//
// Nothing is written. There is no workspace to attach a scan to, so no gtm_opportunities rows and no
// gtm_ai_usage rows — the cost is printed instead and the run is absent from the cost model. Development
// only: it refuses to run with NODE_ENV=production.
import { askForJson, createAiClient } from "../lib/gtm/ai-core.js";
import { PROFILE_JSON_SCHEMA, readProfile } from "../lib/gtm/profile.js";
import { PROFILE_SYSTEM, buildProfilePrompt } from "../lib/gtm/prompts/profile.js";
import { filterCandidates } from "../lib/gtm/radar-filter.js";
import { scoreCandidates } from "../lib/gtm/radar-score.js";
import { readSite } from "../lib/gtm/site-reader.js";
import { searchHn } from "../lib/gtm/sources/hn.js";

function usage() {
	console.log("Usage: npm run dev:gtm-radar -- [--days N] <url>");
	console.log("  --days N   how far back to look (default 7, the first-scan window)");
}

const args = process.argv.slice(2);
let days = 7;
let url = null;

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--help" || arg === "-h") {
		usage();
		process.exit(0);
	} else if (arg === "--days") {
		index += 1;
		days = Number(args[index]);
		if (!Number.isFinite(days) || days <= 0) {
			console.error("--days needs a positive number");
			process.exit(1);
		}
	} else if (arg.startsWith("--")) {
		console.error(`Unknown option: ${arg}`);
		usage();
		process.exit(1);
	} else {
		url = arg;
	}
}

if (process.env.NODE_ENV === "production") {
	console.error("This is a development command and will not run with NODE_ENV=production.");
	process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY is not set");
	process.exit(1);
}
if (!url) {
	console.error("Give the product's web address.");
	usage();
	process.exit(1);
}

const client = createAiClient();
const calls = [];
const ask = (options) => askForJson({ ...options, getClient: () => client, onUsage: (row) => calls.push(row) });
const count = (value) => value.toLocaleString("en-US");

const site = await readSite(url);
if (site.error) {
	console.error(`Could not read the site: ${site.error}`);
	process.exit(1);
}
console.log(`${site.value.title || url} — ${count(site.value.textLength)} characters read`);

const profile = await ask({
	purpose: "profile_extract",
	system: PROFILE_SYSTEM,
	prompt: buildProfilePrompt({ url: site.value.url, siteText: site.value.siteText, pricingText: site.value.pricingText }),
	schema: PROFILE_JSON_SCHEMA,
	read: readProfile,
});
if (profile.error) {
	console.error(`No profile: ${profile.error}`);
	process.exit(1);
}
console.log(`Keywords (${profile.value.keywords.length}): ${profile.value.keywords.join(", ")}`);

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const { candidates, problems } = await searchHn({ keywords: profile.value.keywords, since });
const { kept, counts } = filterCandidates({ candidates, since });

console.log("");
console.log(`Over ${days} days: found ${candidates.length}, kept ${kept.length}`);
for (const [reason, dropped] of Object.entries(counts)) console.log(`  dropped ${dropped}: ${reason}`);
for (const problem of problems) console.log(`  problem on "${problem.keyword}": ${problem.error}`);

const { scored, unscored } = await scoreCandidates({ candidates: kept, profile: profile.value, askForJson: ask });
const byId = new Map(kept.map((candidate) => [candidate.externalId, candidate]));

console.log("");
for (const entry of scored.sort((a, b) => b.score - a.score)) {
	const candidate = byId.get(entry.externalId);
	console.log(`${String(entry.score).padStart(3)} | ${candidate.url}`);
	console.log(`    ${(candidate.storyTitle || "").slice(0, 90)}`);
	console.log(`    ${entry.reason}`);
}

// The queue only offers a founder what scored well, so the run should say the same thing plainly.
const worthIt = scored.filter((entry) => entry.score >= 60).length;
console.log("");
console.log(`${worthIt} worth replying to (60+), ${scored.length} scored, ${unscored.length} unscored`);
if (worthIt === 0 && scored.length > 0) {
	console.log("Nothing scored high. On a quiet platform that is normal; day after day it means the keywords.");
}

const cost = calls.reduce((total, row) => total + (row.estimatedCostUsd ?? 0), 0);
const input = count(calls.reduce((total, row) => total + row.inputTokens, 0));
const output = count(calls.reduce((total, row) => total + row.outputTokens, 0));
console.log(`${calls.length} AI call(s): ${input} in + ${output} out, $${cost.toFixed(5)}`);
console.log("Nothing was written: this run has no workspace, so it is absent from gtm_ai_usage too.");
