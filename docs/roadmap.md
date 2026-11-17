# Namag roadmap

Namag is a newsletter platform that you can sell as accounts: each client gets a workspace with their own domain,
contacts, campaigns and sending reputation, and you run the platform from a separate console. It started from the
open-source MailCheap project and is measured against its hosted version, mailcheap.ai, whose dashboard and public
pages were read on 23 October 2026. Their prices and claims are theirs; this plan uses them only as a yardstick.

The goal: **everything mailcheap.ai does, done at least as well, plus what it lacks** (teams, agencies, a platform console,
safer sending, automation). Each phase is built on its own branch, tested, checked in the local demo and merged only when
approved.

## Where we are

| Done and live | What it is |
|---|---|
| Users, workspaces, roles | Logins, owner and editor roles, invitations, one workspace per client, data kept apart |
| Platform console | Overview with charts, workspaces, accounts, domains, activity log, team, per-client limits and usage |
| Admin separation | Administrators run the console only: no way into a client's data, separate admin-only logins |
| Two-factor login | Authenticator app and recovery codes, required for administrators |
| **A. Safe sending** | Address checks (typos, throwaway, blocklist, dead domains), warm-up, new-people slice, account block, review of risky issues |
| **B. Contacts** | Custom fields and merge tags, contact page, saved segments, background imports up to 250,000 rows |
| Reply-to, delivery events | Required reply-to; SES delivery events switched on so delivery rates are real |

## What mailcheap.ai does, what we take, how we go further

| Area | mailcheap.ai | We take | We go further |
|---|---|---|---|
| Teams and clients | One person per account, no team features | n/a | Workspaces, roles, a console to run many clients (already built) |
| Getting started | Shared sending address per newsletter, so you can send on day one; default postal address; safe defaults on (double opt-in, list cleanup) | The shared address and safe defaults | Guided checklist, registrar-specific DNS help, automatic re-checks |
| Writing and sending | Calm editor, Write / Review / Send steps, test email, preview as a reader with a Gmail phone view, calendar scheduling | The stepper, reader preview, status of each check | A/B subjects, welcome series, resend to non-openers (already built); approval flow for drafts |
| Deliverability | Warm-up, slice for new contacts, pause and block thresholds, list cleaning, public stats page | All of it (built in A) | Per-client status page for clients and administrators, domain blocklist, DMARC check, public stats page |
| Contacts | Fields, contact page, segments, 250k imports | All of it (built in B) | AND/OR segments with "in the next N days" for renewals, fills-gaps-only imports |
| Reports | Hourly opens and clicks, clicks per link, comparison with the last 10 issues | All of it | Flag machine opens, geography and devices, per-client rollups in the console |
| Website | 8 themes shared by site and emails, web-only / email-only issues, own subdomain, embeddable forms | All of it | More form styles (popup, inline, multi-step), RSS, a landing page for each newsletter |
| Billing | Plans by emails sent, slider, monthly or yearly, no trial, 30% affiliate program | The plan slider and the model | Free trial, usage page, invoices, failed-payment handling, revenue dashboard, per-client cost and margin |
| AI and API | About 70 API endpoints, MCP server for Claude, ChatGPT, Cursor | All of it | Webhooks, API keys per workspace, signups-only keys |
| Extras | Best time to send, weekly summary email, help center, changelog | All of it | Automations, template library, domain connection with automatic DNS |

## Phases still to do

Priority runs top to bottom. "Needs" lists what has to exist first.

### P. Onboarding and polish (next; small, no new infrastructure)
Take from mailcheap.ai's dashboard what makes the first ten minutes easy.
- **Review step redesign:** a Write / Review / Send stepper; a checklist with a clear fix button on each failing row; "Next" disabled
  until checks pass; test email and preview on the same screen.
- **Preview as a reader:** pick a sample reader (with a first name or without), Desktop and Mobile, the phone shown as a Gmail inbox.
- **Settings as status cards:** each section shows its state ("Double opt-in on", "Form for your site: off").
- **Safe defaults:** double opt-in and list cleanup on for every new newsletter.
- **Domain page:** step-by-step DNS help for the common registrars, automatic re-checking, a "send a test from this domain" button.
- **Emptier-is-better overview:** clear first-run states instead of empty charts.
- Better than theirs: a first-run checklist for each new workspace (domain, sender, reply-to, import, form for the site).

### C. Reports
- Opens and clicks by hour for the first three days; clicks per link (tracking parameters and scanners ignored); comparison with the last 10 issues.
- Better: mark likely machine opens (Apple Mail privacy) so open rates are honest; geography and devices; each client's reports rolled up in the console.

### D. Signup forms and the newsletter website
- Embeddable signup form (script and plain HTML) with a "get the code" page; popup and inline forms.
- Theme gallery (about eight themes) shared by the website and emails, with colours and fonts to adjust.
- Web-only and email-only issues; RSS; sitemap and share images already exist.
- Better: multi-step forms, a landing page for each newsletter, per-form analytics.

### E. Plans and billing
- Plans by emails per month, a slider picker, monthly or yearly, Stripe checkout and plan changes, over-limit behaviour (signups keep working, sends wait).
- Better: free trial, a usage page for clients, invoices, failed-payment handling (grace period, then suspend), an affiliate program.
- Console: expected monthly revenue, revenue per client, cost per client (SES) and margin.
- Needs: you create a Stripe account; decisions on plans, prices and trial length.

### F. Namag on its own domain
- `namag.io` is the marketing site (see `docs/marketing-website.md`); each client works at `clientA.namag.io`; the console at `admin.namag.io`.
- The host decides the workspace; sessions are per address; links in emails use the client's address.
- Shared sending address per client (`hello@clienta.namag.io`) so they can send before adding their own domain.
- Needs: the domain bought, wildcard DNS and SSL (Cloudflare in front of Hostinger, or a VPS). Can be built and tested locally on `*.localhost` first.

### G. AI and API
- Full REST API with an OpenAPI description and docs; an MCP server with sign-in for Claude, ChatGPT and Cursor, with the rule that sending needs a person's confirmation.
- Better: webhooks to a client's own tools; API keys per workspace; signups-only keys for forms.

### H. Extras
- Best time to send; weekly summary email; help center; public deliverability stats page; changelog.
- Better: automations ("clicked a link", "joined a tag"), template library, approval flow for drafts, DMARC and deliverability health check, data export and workspace deletion.

### I. Later: domains and hosting for clients
- Offer domain registration (through a registrar's reseller API) with the email DNS records added automatically; website hosting as an extra service on a VPS.
- Needs: Phase F, Stripe, a VPS, terms of service and support routines.

## Order

1. **P** (a week of polish that every client sees), then **E** (so accounts can be sold), then **C** and **D**.
2. **F** whenever the domain is bought; the marketing website goes live with it.
3. **G**, **H** and **I** after the first clients.

## Open items outside the phases

- Rotate the exposed database password and the admin password (not `SESSION_SECRET`: changing it locks out everyone who uses two-factor).
- Restore the draft dates the workspace migration changed (cosmetic; needs the backup and your database connection).
- Hostinger: the account was at its process limit because of MovieMood's image library; `VIPS_CONCURRENCY=2` was added there. Check the Max Processes graph after a few days.
- Connect MovieMood's signup to its own workspace.
- Decisions waiting: buy `namag.io`; Cloudflare or VPS; Stripe account; pricing model and trial.
