# Roadmap: matching and going beyond mailcheap.ai

mailcheap.ai is the hosted version of the open-source project this platform started from. The goal is to have
everything it has, then add what it lacks. Compared on 23 October 2026 from its public pages (home, pricing, compare,
changelog, API and MCP docs, help, open stats, affiliates). Its numbers are its own claims.

Each phase is built on its own branch with tests, checked in the local demo, and merged only when approved.

## Already ahead of it

Workspaces with roles and invitations, a platform console (charts, accounts, domains, activity, limits, audit log),
two-factor login, A/B subject tests, a welcome series, resend to non-openers, list cleanup with last-chance emails.

## Phases

### A. Safe sending (all clients share one SES account): built, see docs/workspaces.md
- **Match:** warm-up (small daily volume that grows with a clean record), first sends to new contacts go to a small
  slice and the rest follows 3 hours later if it looks healthy, account block at 5% bounces / 0.3% complaints
  (campaign pause at 2% / 0.08%), filters for typo, disposable and dead domains at signup and import, content scan
  with an "in review" state.
- **Better:** everything per client, visible to the client and in the console; a platform blocklist of domains; a
  "trusted" setting per client; spam-risk tips in the review step.

### B. Contacts: built, see docs/workspaces.md
- **Match:** custom fields usable in emails, a page per contact with its activity, saved segments that update
  themselves, background imports up to 250,000 rows with column mapping and preview.
- **Better:** AND/OR segment rules with live counts; fallbacks on every merge tag.

### C. Reports
- **Match:** opens and clicks by hour, clicks per link, comparison with the last 10 issues.
- **Better:** flag likely machine opens (Apple Mail privacy), geography and devices.

### D. Signup and website
- **Match:** embeddable signup form (script and plain HTML), 8 themes shared by site and emails, web-only and
  email-only issues.
- **Better:** popup, inline and multi-step forms; a landing page builder.

### E. Plans and billing
- **Match:** plans by emails sent, Stripe checkout, plan changes, over-limit behaviour, yearly discount.
- **Better:** a free trial, a usage page for clients, invoices, failed-payment handling, an affiliate program.

### F. Namag on its own domain
Each client at `clientA.namag.io` (login and dashboard), the console at `admin.namag.io`, the marketing site at
`namag.io`. Needs the domain bought and wildcard DNS and SSL (Cloudflare in front of Hostinger, or a VPS).

### G. AI and API
- **Match:** the full REST API with docs, an MCP server with sign-in for Claude, ChatGPT and Cursor.
- **Better:** webhooks to a client's own tools; API keys per workspace.

### H. Extras
- **Match:** best-time-to-send, weekly summary email, help center, public deliverability stats page.
- **Better:** automations (triggers such as "clicked a link"), template library, approval flow for drafts, domain
  connection with automatic DNS, a DMARC and deliverability health check.

## Suggested order

A, B, E first (safe and sellable), then C and D, then G and H. F whenever the domain is ready.
