# The Namag marketing website

The site at `namag.io` that sells the product. The app itself lives at `clientA.namag.io` (dashboards) and
`admin.namag.io` (the console); this site only explains, convinces and sends people to sign up.

## Who it is for

1. **Agencies and freelancers** who run newsletters for several clients and want one place, each client under their own
   domain, with their own sending reputation. (The biggest difference from every competitor we looked at.)
2. **Creators and small businesses** who want to send from their own domain and keep their list, without paying for a
   huge platform.
3. **People leaving Mailchimp, Klaviyo or beehiiv** because of price per subscriber, or lack of control.

## What it says (messages, in order of importance)

1. **Send from your own domain, safely.** Warm-up, address checks and automatic protection are on by default, so a new
   sender doesn't land in spam.
2. **Run every client in one place.** Separate workspaces, roles, a console; each client at their own address.
3. **Honest numbers.** Machine opens flagged, delivery tracked, one-click unsubscribe, clear limits.
4. **Fair pricing.** Pay for emails sent, every plan has every feature (final prices come from Phase E).
5. **Yours.** Export your list any time; your domain, your data.

Tone: plain, specific, no hype; show the product rather than describe it.

## Pages

| Page | Purpose | Key content |
|---|---|---|
| Home | Convince in one screen, then prove | Headline and one sentence; a real product screenshot; three message blocks; how it works in 3 steps; pricing teaser; a comparison strip; final call to action |
| Pricing | Decide | The plan picker (slider by emails per month), what every plan includes, monthly or yearly, FAQ, "more than 2,000,000 emails? talk to us" |
| Features | Detail | Grouped: Writing and sending, Contacts and segments, Reports, Website and forms, Deliverability, Teams and agencies, API and AI |
| For agencies | The differentiator | Multi-client story, roles, console, per-client domains and limits, white-label direction, a short walk-through |
| Compare | Win searches and doubts | One page each: Mailchimp, Klaviyo, beehiiv, MailerLite, Substack, mailcheap.ai: an honest table, with what the others do better |
| How sending stays safe | Trust | Warm-up, address checks, thresholds, review of risky issues, public stats later |
| Help center | Reduce support | Getting started, domains and DNS (per registrar), importing, sending, deliverability, billing |
| Changelog | Show momentum | Dated list of what shipped |
| Sign up / Log in | Convert | Create a workspace (pick the address `name.namag.io`), start the trial; log-in finds your workspace |
| About and contact | Human side | Who builds it, how to reach you |
| Legal | Required | Terms, privacy, acceptable use (spam and abuse rules), data-processing agreement for clients |
| Blog | Search traffic, later | Guides: warm-up, DNS records, moving from Mailchimp, deliverability |

## Home page outline

1. **Hero:** headline, one line, two buttons (Start free trial, See how it works), an animated or still product screenshot
   (the overview with charts) on a calm background.
2. **Three promises** with a screenshot each: your own domain and safe sending; every client in one place; honest reports.
3. **How it works:** add your domain, import your list, write and send. Real screens, three steps.
4. **For agencies:** a short strip with the console and a client switcher.
5. **Pricing teaser:** the slider, the starting price, "every plan has every feature".
6. **Compare strip:** "Switching from Mailchimp?" with the import flow.
7. **FAQ** and a final call to action.

## Design direction

- Same brand as the product (logo, type, restrained dark and light themes) so the site and the dashboard feel like one thing.
- Product screenshots are real: taken from the seeded demo (`npm run dev:demo`), so numbers look believable and nothing private appears.
- Fast and light: no heavy scripts; works well on a phone first.
- Accessible: real headings, contrast, keyboard use, reduced-motion respected.
- Build with the design skills available here (taste and layout reviews) once the structure and copy are agreed.

## How it is built and hosted

- **Recommended:** a separate static site (HTML, CSS, a little JavaScript) in its own repository, deployed to the Hostinger plan
  as a static site on the apex `namag.io`. It is independent of the app, costs no Node process, and loads instantly.
  A small static site generator (for example Astro) keeps pages consistent and makes the blog and comparison pages easy.
- **Alternative:** a marketing area inside the Next.js app on the apex host. One codebase, but it ties the site's uptime and
  the process limit to the app.
- **Sign up** is a link into the app (`app.namag.io/signup`, built in Phase E/F), so the site needs no database.
- **Analytics:** the cookie-free, privacy-friendly kind already used on the portfolio, so no cookie banner is needed.
- **SEO:** one page per intent, clean URLs, titles and descriptions, a sitemap, structured data for pricing and FAQ, fast pages.

## Search plan (first pages to write)

- "Mailchimp alternative" and one comparison page per competitor.
- "Send newsletters from your own domain", "Amazon SES newsletter", "newsletter platform for agencies".
- "How to warm up a new sending domain", "SPF DKIM DMARC explained", "import subscribers from Mailchimp".

## Build steps

| Step | What | Needs |
|---|---|---|
| M1 | Structure, copy for Home, Pricing, Features, For agencies; a rough static site | Decisions on the message and plan names |
| M2 | Visual design, real screenshots, mobile polish, legal pages | The demo data; terms written or reviewed |
| M3 | Pricing wired to the real plans; sign-up links | Phase E (billing) and F (the domain) |
| M4 | Comparison pages, help center, first blog posts | Product screenshots, real numbers |
| M5 | Launch: domain live, analytics, sitemap submitted, first announcement | The domain bought, everything above |

M1 and M2 can start now with placeholders, and be finished once the domain and plans exist.

## Decisions needed

- The product name's tagline (one sentence that says what Namag is).
- Plan names and prices, and whether there is a free trial (Phase E).
- Whether to start with the agency story or the single-newsletter story on the home page (my suggestion: agencies, since that is the difference).
- Whether to build the site in a separate repository (recommended) or in the app.
