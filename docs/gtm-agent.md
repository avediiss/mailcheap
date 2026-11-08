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

## The radar

### What it searches, and why the parameters matter more than the code

Hacker News first, through its Algolia search: no key, no account, no quota to negotiate, so the whole loop
can be proved for nothing before anyone pays X for the privilege. `lib/gtm/sources/hn.js` owns every detail
of that API; everything above it sees a platform-neutral candidate.

The search parameters are the most consequential decision in the radar, because every post that comes back
costs money to score later. Measured over ninety days of comments:

| keyword | quoted phrase | every word, no typos | Algolia's defaults |
| --- | --- | --- | --- |
| google analytics alternative | 0 | **5** | 5 |
| ga4 | 12 | **12** | 57,555 |
| cookieless analytics | 2 | **4** | 4 |
| privacy analytics | 0 | **34** | 101 |
| self hosted analytics | 0 | **8** | 23 |

Typo tolerance is what inflates a short keyword into tens of thousands of matches; a phrase search is what
collapses a real keyword to nothing, because people write the words in their own order. So the radar asks
for **every word, anywhere in the comment, spelled correctly**, and matches only the comment's own text — a
reply under a headline containing the keyword is not someone discussing it. A test pins each of those three
choices with the numbers above, so none of them is quietly undone.

### What it remembers

`lib/gtm/radar-store.js`. Each watched source carries `lastScanAt`, so the next scan asks only for what is
newer and a post is fetched once however often the scan runs. A source never read looks back
`GTM_LIMITS.radarFirstRunHours` (a week) rather than at the whole archive. **A failed scan does not move the
watermark** — advancing it would silently skip the window that failed, and nobody would know what was lost;
the reason goes to `lastError` instead, cleared by the next success.

Opportunities upsert on `{productId, externalId}`. A post seen again has its text refreshed, since a comment
can be edited, but its `status`, `score` and `reason` are written once and never touched again: they belong
to the founder, and re-offering a post they skipped every three hours would make the queue useless. The
uniqueness is per product, so two founders can hold the same post.

### The caps

`maxCandidatesPerKeyword` (25) bounds what one keyword contributes; `maxScoredPerScan` (50) bounds what one
scan may put in front of the AI. On Hacker News neither binds in practice — a live scan with six keywords
over thirty days returned eight posts — but they are the difference between a quiet bill and a surprising
one on a busier platform.

### The cost gate

`lib/gtm/radar-filter.js` stands between searching, which is free, and scoring, which is charged per post.
It drops what a person would reject on sight: a post already in the queue, one the founder wrote, an
acknowledgement too short to reply to, one older than the scan window, and anything in one of Hacker News's
monthly megathreads — "Who is hiring", "Who wants to be hired", "What are you working on". Those threads
mention every tool there is and ask for nothing; on a live scan they were **six of fourteen results**.

Every drop carries its reason and the reasons are counted, so "why is my queue empty" has an answer. What
survives is ranked by how many of the product's keywords found it, then by recency, and cut to
`maxScoredPerScan`.

The minimum length is deliberately low (30 characters). The instinct is to demand substance, but the best
opportunity a radar can find is "anyone know something simpler than GA4?" — thirty-nine characters. A
higher bar would quietly keep the essays and throw away the questions.

### Scoring

`lib/gtm/radar-score.js` with its prompt in `lib/gtm/prompts/score.js`. Ten posts per call, because the
product profile is sent once per batch instead of once per post. The model is chosen by purpose:
`score_opportunity` runs on `claude-haiku-5-5`, around forty times cheaper than the default, because
"is this person describing our problem" is a short question about a short comment. Drafting, where a
person's name goes on the answer, keeps the good model. `GTM_AI_MODEL` still overrides every purpose at
once.

A score belongs to a post that was in the batch or it is discarded — a model inventing an id must never
land a score on something nobody asked about. Entries missing a number or a reason are dropped and the
rest still count; a batch with nothing usable is an error, which `askForJson` retries once. A failed batch
costs that batch, not the scan: its posts are saved unscored and the next scan tries again.

**Measured on a live scan:** eight posts, one call, 4,142 input and 400 output tokens, **$0.00061**. Every
one scored 12 or below, with reasons like "explaining EU cookie banner law to others in general; an expert
commentary, not a request for help". That is the correct answer — and the prompt says so in as many words,
because a prompt that reads "find the good ones" produces a model that finds good ones whether or not they
exist.

### What Hacker News turned out not to have

Hacker News was chosen first because it is free, which it is. Measured against a real product — privacy
analytics, ten keywords, comments and stories, ninety days — it returned 101 posts, of which 60 survived
the filter and **none scored above 40**. The best were an expert explaining cookie law, someone auditing
apps for tracking SDKs, and a complaint about a competitor's founder.

Three things were tried and none of them was the problem:

| tried | result |
| --- | --- |
| better keywords — help-seeking language rather than category nouns | still zero |
| searching stories and Ask HN, not only comments | 32 posts became 101, still zero |
| a stricter or looser matching strategy | changes volume, not quality |

Hacker News is a place where people discuss, explain and show their work. People asking "what should I use
instead of X" do that on Reddit. The radar is right; the platform was wrong for this product. Every piece
of it — the candidate shape, the filter, the scorer, the store — is platform-neutral, so Reddit is one new
file in `lib/gtm/sources/` rather than a rewrite.

### Reddit

`lib/gtm/sources/reddit.js`, and built the other way round from Hacker News on purpose. Hacker News is a
search engine, so the radar asks it questions. Reddit is a set of rooms, so the radar reads what was
posted in each room and matches the keywords itself — one request per subreddit per scan instead of one
per keyword per subreddit, no search relevance to argue with, and one visible definition of "matched" that
is the same on every platform: every word of a keyword must appear somewhere in the post.

**Reddit needs an app.** Every unauthenticated route is gone — `www`, `old`, search and plain listings all
answer 403 — so it reads through OAuth client credentials or not at all. Create a script app at
reddit.com/prefs/apps and set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. Without them the radar skips
Reddit sources and says so in the scan's problems rather than failing. The token is fetched once per
process and reused until it is a minute from expiring.

**Not yet proved against the live API.** Every test runs against a fake. The token exchange, the listing
shape and the rate limits come from Reddit's documentation, and the first real call will say whether that
was enough — which, on this project's record, is a coin toss.

### What search cannot do

Of those eight live results, the top three were a "Who wants to be hired" résumé, a competitor's job ad and
a product launch post. All three legitimately contain the keywords; none is a person with the problem. No
mechanical rule separates "mentions analytics" from "needs analytics", which is why scoring is not a ranking
layer on top of search — it is where almost all of the judgement lives.

## Tests

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

Week 1 is finished — the foundation.

### Week 2 — the radar finds things

- **Phase 1 — the Hacker News client.** Done: `lib/gtm/sources/hn.js`, with the matching strategy chosen
  from measurements rather than from the documentation, and proved against the live API.
- **Phase 2 — watermark and dedup.** Done: `lib/gtm/radar-store.js`, `lastScanAt` and `lastError` on a
  source, opportunities that upsert without ever overwriting what the founder decided.
- **Phase 3 — the cost gate.** Done: `lib/gtm/radar-filter.js` drops what is already stored, the founder's
  own, too short, too old or in a megathread, counts every reason, and caps what one scan may cost.
- **Phase 4 — scoring.** Done: `lib/gtm/radar-score.js`, batched, on the cheap model, validated and
  retried like every other AI call. Proved against live posts for less than a tenth of a cent.
- **Phase 5 — the queue.** Done: `/gtm/radar` lists unhandled posts best first with the score, the reason
  and a skip, and an empty state that says which kind of empty it is. Unscored posts sort last rather than
  hiding, so a failed batch never looks like a quiet day.
- **Phase 6 — wiring.** Done: the three-hourly scan reads every ready product's sources, filters, scores
  and fills the queue, and `npm run dev:gtm-radar -- <url>` runs one by hand against a real product.

Week 2 is finished. The loop runs: scan, filter, score, queue. Nothing is drafted and nothing is posted —
that is Week 3 onwards.

### Running one scan by hand

```bash
npm run dev:gtm-radar -- https://plausible.io          # the first-scan window, seven days
npm run dev:gtm-radar -- --days 30 https://plausible.io
```

Reads the site, extracts a profile as onboarding would, searches on that profile's own keywords, applies
the same filter the scheduled scan applies, scores what survives and prints each verdict with its reason.
Writes nothing — no workspace, so no `gtm_opportunities` and no `gtm_ai_usage` either, and the cost is
printed instead. A real run against Plausible over seven days: 9 found, 5 dropped as megathreads, 4 scored,
**0 worth replying to**, two AI calls, $0.028.
- **Reddit.** Written and tested, waiting on credentials: Reddit replaced self-service app registration
  with an approval process, so `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` need an approved app.

Nothing is drafted and nothing is posted: that is Week 3 onwards.
