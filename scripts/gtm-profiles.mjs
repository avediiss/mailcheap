// Runs the GTM agent's onboarding steps 1 and 2 over real websites and prints what the prompts produced, so
// a prompt edit can be judged on actual products instead of guessed at.
//
//   npm run dev:gtm-profiles -- https://plausible.io https://linear.app
//   npm run dev:gtm-profiles -- --file urls.txt
//   npm run dev:gtm-profiles -- --profile-only https://posthog.com
//
// The key comes from ANTHROPIC_API_KEY. The npm script loads .env.local if there is one, so the same file
// the dev server reads serves this too; otherwise put it in front of the command.
//
// Step 1 reads the site (lib/gtm/site-reader.js) and extracts the profile; step 2 asks the interview
// questions the founder would be shown. That is two AI calls per URL, or one with --profile-only.
//
// The prompts come from lib/gtm/prompts/ and the call goes through lib/gtm/ai-core.js, the same path the app
// takes, so what prints here is what a founder would get. Nothing is written: there is no workspace to
// attach the run to, so no gtm_products row and no gtm_ai_usage row — what the run cost is printed instead.
//
// For development only, and it spends real money on the API: it refuses to run with NODE_ENV=production.
import { readFile } from "node:fs/promises";
import { askForJson, createAiClient } from "../lib/gtm/ai-core.js";
import { INTERVIEW_JSON_SCHEMA, PROFILE_JSON_SCHEMA, readInterviewQuestions, readProfile } from "../lib/gtm/profile.js";
import { INTERVIEW_SYSTEM, buildInterviewPrompt } from "../lib/gtm/prompts/interview.js";
import { PROFILE_SYSTEM, buildProfilePrompt } from "../lib/gtm/prompts/profile.js";
import { readSite } from "../lib/gtm/site-reader.js";

function usage() {
	console.log("Usage: npm run dev:gtm-profiles -- [--file <path>] [--profile-only] <url> [url...]");
	console.log("  --file <path>    read URLs from a file, one per line (# starts a comment)");
	console.log("  --profile-only   stop after the profile, skipping the interview questions");
}

const args = process.argv.slice(2);
const urls = [];
let listFile = null;
let profileOnly = false;

for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--help" || arg === "-h") {
		usage();
		process.exit(0);
	} else if (arg === "--file") {
		index += 1;
		listFile = args[index];
		if (!listFile) {
			console.error("--file needs a path");
			process.exit(1);
		}
	} else if (arg === "--profile-only") {
		profileOnly = true;
	} else if (arg.startsWith("--")) {
		console.error(`Unknown option: ${arg}`);
		usage();
		process.exit(1);
	} else {
		urls.push(arg);
	}
}

if (listFile) {
	const text = await readFile(listFile, "utf8");
	for (const line of text.split("\n")) {
		const url = line.split("#")[0].trim();
		if (url) urls.push(url);
	}
}

// A development tool that calls a paid API has no business running on a server.
if (process.env.NODE_ENV === "production") {
	console.error("This is a development command and will not run with NODE_ENV=production.");
	process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
	console.error("ANTHROPIC_API_KEY is not set");
	process.exit(1);
}
if (urls.length === 0) {
	console.error("Give at least one URL, or a list with --file.");
	usage();
	process.exit(1);
}

const client = createAiClient();
// Every attempt lands here, the retries included, so the run can say what it actually cost.
const calls = [];

// One step, with the line of cost and timing that makes a prompt change comparable between runs.
async function ask({ purpose, system, prompt, schema, read }) {
	const before = calls.length;
	const result = await askForJson({
		getClient: () => client,
		purpose,
		system,
		prompt,
		schema,
		read,
		onUsage: (usage) => calls.push(usage),
	});
	return { result, note: describe(calls.slice(before)) };
}

function describe(attempts) {
	const seconds = sum(attempts, "durationMs") / 1000;
	const input = sum(attempts, "inputTokens");
	const output = sum(attempts, "outputTokens");
	const retries = attempts.length > 1 ? `, ${attempts.length} attempts` : "";
	return `[${seconds.toFixed(1)}s, ${count(input)} in + ${count(output)} out, ${money(cost(attempts))}${retries}]`;
}

function sum(rows, field) {
	return rows.reduce((total, row) => total + (row[field] ?? 0), 0);
}

// Null, not zero, when any attempt used a model with no price in lib/gtm/config.js: an unpriced call is an
// unknown, and a run that quietly called it free would be worse than one that admits it doesn't know.
function cost(rows) {
	if (rows.some((row) => typeof row.estimatedCostUsd !== "number")) return null;
	return sum(rows, "estimatedCostUsd");
}

const count = (value) => value.toLocaleString("en-US");
const money = (value) => (value === null ? "cost unknown" : `$${value.toFixed(4)}`);

const LABEL_WIDTH = 12;
const TEXT_WIDTH = 84;

// Labelled and wrapped, because a pitch and a list of fifteen keywords are both read by eye here.
function field(label, text, width = LABEL_WIDTH) {
	const [first, ...rest] = wrap(String(text), TEXT_WIDTH);
	console.log(`    ${label.padEnd(width)}${first ?? ""}`);
	for (const line of rest) console.log(`    ${" ".repeat(width)}${line}`);
}

function wrap(text, width) {
	const lines = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

function printProfile(profile) {
	field("Pitch", profile.one_line_pitch);
	field("Customer", profile.target_customer);
	profile.pains.forEach((pain, index) => field(index === 0 ? "Pains" : "", `- ${pain}`));
	field("Different", profile.differentiators);
	field("Keywords", profile.keywords.join(", "));
	field("Communities", profile.suggested_communities.join(", ") || "(none offered)");
}

let failed = 0;

// One URL at a time: the output is meant to be read, and a founder's onboarding is one site at a time too.
for (const [index, url] of urls.entries()) {
	if (index > 0) console.log("");
	console.log(`=== ${url}`);

	const site = await readSite(url);
	if (site.error) {
		console.log(`  Could not read the site: ${site.error}`);
		failed += 1;
		continue;
	}
	const page = site.value;
	const pricing = page.pricingUrl ? `, pricing page ${page.pricingUrl}` : "";
	console.log(`  ${page.title || "(no title)"} — ${count(page.textLength)} characters${pricing}`);
	if (page.needsDescription) {
		console.log("  Too little text to describe a product: the app would ask the founder to paste one. Asking anyway.");
	}

	const profile = await ask({
		purpose: "profile_extract",
		system: PROFILE_SYSTEM,
		prompt: buildProfilePrompt({ url: page.url, siteText: page.siteText, pricingText: page.pricingText }),
		schema: PROFILE_JSON_SCHEMA,
		read: readProfile,
	});
	console.log(`  Profile ${profile.note}`);
	if (profile.result.error) {
		console.log(`    No profile: ${profile.result.error}`);
		failed += 1;
		continue;
	}
	printProfile(profile.result.value);

	if (profileOnly) continue;

	const questions = await ask({
		purpose: "interview_questions",
		system: INTERVIEW_SYSTEM,
		prompt: buildInterviewPrompt({ url: page.url, profile: profile.result.value, siteText: page.siteText }),
		schema: INTERVIEW_JSON_SCHEMA,
		read: readInterviewQuestions,
	});
	console.log(`  Questions ${questions.note}`);
	if (questions.result.error) {
		console.log(`    No questions: ${questions.result.error}`);
		failed += 1;
		continue;
	}
	// A narrower label than a profile field's: these are a numbered list, not a column of headings.
	questions.result.value.forEach((question, position) => field(`${position + 1}.`, question, 4));
}

const unpriced = calls.filter((row) => typeof row.estimatedCostUsd !== "number").length;
console.log("");
console.log(
	`${urls.length} site(s), ${calls.length} AI call(s): ${count(sum(calls, "inputTokens"))} in + ${count(sum(calls, "outputTokens"))} out`
);
console.log(`Estimated cost: ${money(cost(calls))}${unpriced ? ` (${unpriced} call(s) used a model with no price in lib/gtm/config.js)` : ""}`);
console.log("Not logged to gtm_ai_usage: this run has no workspace to attach the calls to.");
if (failed > 0) {
	console.log(`${failed} step(s) did not finish.`);
	process.exitCode = 1;
}
