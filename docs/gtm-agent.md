# GTM agent

A module inside Namag that helps a solo founder get their first users: it finds posts worth replying to on
X and one community site, drafts replies in the founder's own voice, and sends people to a Namag-hosted
landing page where the signups are tracked.

It is deliberately separable. Everything it owns lives under `lib/gtm/`, `models/gtm/`, `app/(app)/gtm/`
and `components/gtm/`, every collection it writes is named `gtm_*`, and nothing in it runs unless
`GTM_ENABLED=true`. It reuses Namag's logins, workspaces and contacts rather than keeping its own.

## Switching it on

Two variables, in `.env.local` for local work (git-ignored; `.env.example` is the template) or in the
hosting environment:

```
GTM_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
```

`GTM_ENABLED` must be exactly `true`; anything else leaves the module off. `GTM_AI_MODEL` overrides the
default model (`claude-opus-5-5`) — add it to the price table in `lib/gtm/config.js` first, or its calls
will be logged with no cost.

## Who owns a product

Namag scopes all data by workspace, so the GTM agent does too: `gtm_products.workspaceId` is required, one
product per workspace, and `createdBy` records which member started it. Every query filters by workspace,
like the rest of the app.

## The tables

Collection names carry the `gtm_` prefix; field names are camelCase like every other model in the repo.

| Collection | What a row is |
|---|---|
| `gtm_products` | The product being marketed: its URL, pitch, target customer, pains, differentiators, keywords, the raw site text, and where onboarding got to |
| `gtm_onboarding_interviews` | The 3–4 questions the AI asked about what the site left unclear, and the founder's answers |
| `gtm_watched_sources` | An account or community to watch: the pasted URL, the detected platform, and the identifier the radar queries |
| `gtm_voice_samples` | Something the founder wrote, used verbatim in the drafting prompt |
| `gtm_opportunities` | A post worth replying to: its text, score, score breakdown and reason. Unique per product by the platform's own id |
| `gtm_drafts` | A reply, as the AI wrote it and as the founder edited it |
| `gtm_actions` | What was done with a draft: posted, copied for the founder to post, or skipped |
| `gtm_links` | A tracked short link to the landing page, usually tied to one action |
| `gtm_clicks` | One visit to a tracked link. The address is stored only as a hash |
| `gtm_signups` | A signup credited to the module, pointing at the Namag contact rather than copying the address |
| `gtm_ai_usage` | One row per AI call: purpose, model, input and output tokens, estimated cost in dollars. This is what the cost model is built from |

Only the first four are written this week. The rest exist now so the schema is settled.

### Onboarding steps

`gtm_products.onboardingStatus` is both the progress record and where the wizard resumes:
`new` → `site_read` → `interviewed` → `profile_reviewed` → `sources_added` → `ready`.

### What the AI costs

Every call through `lib/gtm/ai.js` writes a `gtm_ai_usage` row whether it succeeded or not, with the tokens
actually billed and a dollar estimate from the price table in `lib/gtm/config.js`. A model with no price on
file logs `estimatedCostUsd: null` — an unknown cost reads as unknown, never as zero.

## The radar schedule

Namag had no recurring scheduler — every other job is one-shot or reschedules itself — so the scan runs on
a **QStash schedule**, which needs no new infrastructure and reuses the signature check every other job
route already has. It is created once per environment, as a deploy-time step:

```bash
QSTASH_TOKEN=... APP_URL=https://your-domain node scripts/gtm-schedule.mjs --show
```

`--create` registers it, `--remove` takes it away. The schedule has a fixed id (`gtm-radar-scan`), so
`--create` is safe to run again: it updates the one schedule instead of adding a second that scans three
hours out of phase. `APP_URL` must be the public URL — a local one is refused rather than scheduled and
then silently never delivered.

The schedule and the feature flag are independent. With `GTM_ENABLED` unset the job still answers 200 and
logs `{"skipped":"the GTM agent is off"}`, so the schedule can be left in place while the module is off and
QStash does not retry it. `/api/jobs/gtm-radar` is reachable only with a valid QStash signature; unsigned,
it answers 503.

This week the scan searches nothing. It reports what it *would* search — how many products have finished
onboarding, how many sources are switched on — which is what makes the log line worth reading while the
schedule is being proved.

## Onboarding, step by step

`lib/gtm/onboarding.js` is the whole backend of the wizard. Each function saves before it returns, so a
founder who closes the tab resumes where they were. Nothing in it reads the session or redirects — the
server actions in `app/(app)/gtm` do that and call these.

| Step | Function | What it does |
|---|---|---|
| 1 | `readSiteAndExtractProfile` | Reads the site and its pricing page, then extracts the profile |
| 2a | `startInterview` | Asks the AI for 3–4 questions about what the site left unclear |
| 2b | `answerInterview` | Saves the answers, then folds them back into the profile |
| 3 | `saveProfile` | Stores the founder's own edits, without re-asking the AI |
| 4 | `saveWatchedSources` | Turns pasted links into watched sources |
| 5 | `saveVoiceSamples` | Replaces the set of voice samples |
| — | `getOnboardingState` | Everything the wizard and the summary screen need, in one read |

Progress only moves forward (`furthestStatus`): a founder who re-reads their site after finishing is not
sent back to step one.

### Reading the site

`lib/gtm/site-reader.js` fetches the page with a 10-second timeout and a `User-Agent` that says who is
asking, then follows a `pricing` or `plans` link on the same host. The link is found in the raw HTML
because it almost always lives in the nav, which `lib/gtm/html-text.js` deliberately throws away along
with scripts, styles, headers, footers, forms and anything the page marks `aria-hidden`.

Under ~300 characters of readable text the site is a JavaScript shell. The reader returns
`needsDescription: true`, the product row is still created so the founder has something to come back to,
and **no AI call is spent** — the UI asks them to paste a description instead, which then goes into the
prompt alongside whatever the page did have.

### The AI calls

The module talks to an AI in one place, through one function, `askForJson`. Nothing above it knows the
provider, the model or the token accounting, so swapping provider means rewriting one file and nothing else.
It sits in two files only because of who calls it:

| File | What it is | Imports |
| --- | --- | --- |
| `lib/gtm/ai-core.js` | the provider: builds the request, reads the answer, insists on the shape, says what the call cost | relative, no `server-only` — plain Node can run it |
| `lib/gtm/ai.js` | the app's door to it: holds the client and writes the `gtm_ai_usage` row | `server-only`, `@/` |

`scripts/gtm-profiles.mjs` imports the core directly, so the command checks the request the app really
sends rather than a second copy of it that could drift. The same split as `radar-jobs.js` /
`radar-schedule.js`, for the same reason.

It uses the official `@anthropic-ai/sdk` with `claude-opus-5-5` and constrains the answer with
`output_config.format` (a JSON Schema), then validates it anyway in `lib/gtm/profile.js` and **retries
once** with the reason the first answer failed. Twice is the limit: a model that gets the shape wrong twice
is being asked the wrong question, and a founder waiting on a page should be told so.

Refusals (`stop_reason: "refusal"`) and truncated answers are reported in plain words rather than parsed as
content. Server-side fallbacks are enabled, so a safety decline is retried on another model inside the same
call instead of simply stopping.

**Still not verified against the live API.** Every test runs against a stub, and the end-to-end check of
`scripts/gtm-profiles.mjs` ran against a local server standing in for the API. The request shape comes from
the SDK's own types and the current API reference. Pointing the command at a real product, with a real key,
is the first call that proves it — which is what the command is for.

### The prompts

In `lib/gtm/prompts/`, one file per prompt, as plain exported strings and builder functions:
`profile.js` (extraction) and `interview.js` (the questions, and the refinement). The JSON shape they must
return is **not** in these files — it lives with its validation in `lib/gtm/profile.js`, so editing the
wording can't drift from what the code insists on. A test holds the schema and the validator to each other.

### Checking the prompts on real products

Editing a prompt and guessing at the result is how prompts rot. This command runs steps 1 and 2 over real
websites and prints what came back:

```bash
npm run dev:gtm-profiles -- https://plausible.io https://linear.app
npm run dev:gtm-profiles -- --file urls.txt            # one URL per line, # for comments
npm run dev:gtm-profiles -- --profile-only https://posthog.com
```

The key comes from `ANTHROPIC_API_KEY`. The npm script passes `--env-file-if-exists=.env.local`, so the key
lives in the same ignored file `next dev` reads and the command needs nothing in front of it. Running the
script with plain `node` reads nothing: pass the key on the line, as `scripts/gtm-schedule.mjs` expects too.

For each URL it prints what the site reader got (title, characters, pricing page, and whether the text was
too thin to describe a product), then the profile, then the interview questions the founder would be shown —
each with its own seconds, tokens, cost and attempt count, so two runs of a changed prompt can be compared.
A run ends with the total and exits non-zero if any step failed.

Two things it deliberately does not do. It **writes nothing**: there is no workspace to attach a run to, so
no `gtm_products` row and, because `workspaceId` is required, no `gtm_ai_usage` row either — the cost is
printed instead and the run is absent from the cost model. And it **refuses to run with
`NODE_ENV=production`**: it is a development tool that spends real money, one API call per step, per URL.

```bash
npm test                                # lib/gtm unit tests, no database
npm run test:db                         # the schema, the onboarding services and the server actions
```

The AI's own path — request shape, refusals, truncation, the retry, the cost of a call — is tested in
`tests/gtm-ai-core.test.mjs` against a fake client, which `lib/gtm/ai-core.js` exists to make possible.
The one thing neither suite covers is the page component: the database harness runs plain Node with no JSX
transform, so `app/(app)/gtm/page.js` is proved by `npm run build` and by opening it.

## Where it stands

- **Phase 1 — data model.** Done: the eleven models, the feature flag, the cost estimator, and the tests.
- **Phase 2 — background jobs.** Done: the 3-hourly scan on a QStash schedule, the signed job route, and
  `scripts/gtm-schedule.mjs` to create, show or remove it. It logs what it would search and searches nothing.
- **Phase 3 — onboarding backend.** Done: site reader, the one AI client with usage logging, profile
  validation with one retry, the interview, link detection and voice samples.
- **Phase 4 — onboarding UI.** Done: the six-step wizard, saving after each step.
- **Phase 5 — prompt check.** Done: `npm run dev:gtm-profiles` runs steps 1–2 over a list of URLs and prints
  the profiles with what they cost. The AI client is now split so the command uses the app's own request
  path. Still unproven against the live API: that takes a real key and a real product.

Week 1 is finished — the foundation. The radar searches nothing, nothing is drafted and nothing is posted:
that is Week 2 onwards.
