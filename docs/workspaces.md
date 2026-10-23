# Workspaces

One Namag install serves many **workspaces**: each client, or each of the owner's own brands, with its
own newsletters, contacts, campaigns, stats, API keys, sending domains and logins. A person in one workspace
can't see or change another's.

## Who can do what

- **Platform administrator** (`User.isPlatformAdmin`): controls and checks the platform from the console
  (`/platform`): clients, limits, suspensions, domains, the team. They have **no access inside a workspace**: no
  contacts, campaigns or newsletters, and no way to switch into one. They see inside only if a client invites them
  as a member, like anyone else. The first one is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` at their first login
  (or by the migration). After that the database decides: changing `ADMIN_PASSWORD` in the environment changes nothing.
  An account can be an administrator and a member at once (the original install is), but the cleanest setup is a
  separate administrator-only login, which lands in the console and has no workspace menu.
- **Workspace owner**: members, domains, API keys, and everything an editor can do.
- **Workspace editor**: newsletters, campaigns, contacts.

## The rules the code keeps

1. Every dashboard page and server action starts with `requireWorkspace()` (lib/workspace.js) and finds
   anything it is given by id **together with** the `workspaceId`. Another workspace's id is "not found".
2. An API key belongs to a workspace. `/api/v1/*` looks newsletters up inside the key's workspace only.
3. Everything created under a newsletter (contacts, campaigns, messages, events) copies the newsletter's
   `workspaceId`. It is never taken from the request.
4. Sending: a suspended workspace sends nothing, and a workspace sends only from addresses on its own
   `Domain`s. Checked for every batch in `sendMessageBatch`, and early when a campaign is queued.
5. Suppressions: **bounces are global** (no `workspaceId`: a hard bounce hurts the shared sending reputation);
   **complaints and manual opt-outs belong to one workspace**.
6. Alerts: new-subscriber emails go to that workspace's owners only. Paused sends and complaints go to the
   owners and the platform owner. Everything else goes to the platform owner (`ADMIN_EMAIL`).
7. Sessions: the cookie holds `userId` + `sessionVersion`. `getSession()` checks the database, so disabling a
   person or changing their password signs them out at once. Don't rotate `SESSION_SECRET`: emailed links
   (unsubscribe, confirm, tracking) are signed with keys derived from it.

## Moving an existing install to workspaces

Do this **before** deploying the workspace version: the new code only shows data that has a workspace.

1. Take a backup (an Atlas snapshot, or `mongodump`).
2. Look first: `MONGODB_URI=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/migrate-workspaces.mjs --dry-run`
3. Apply: the same command with `--yes`. It is safe to run again.
4. Deploy. You log in once more (the session cookie changed).

## Tests

- `npm test`: fast unit tests.
- `npm run test:db`: runs the real server actions, API routes and sending code against a temporary
  MongoDB (mongodb-memory-server, downloaded once into `node_modules/.cache`). SES and Next's cookies are
  stand-ins (tests/db/stubs). `tests/db/isolation.test.mjs` is the workspace-isolation suite: add a case
  there for every new place that reads or writes tenant data.

## Running the workspace screens

- **Members** (`/members`): owners invite by email with a role, resend, copy a new link, revoke, change roles and
  remove people. Invitation links work for 7 days, once. A workspace always keeps at least one owner.
  Editors see the list read-only.
- **Domains** (`/domains`): owners add a domain, which creates a sending identity in the platform's SES account and
  shows the DNS records. A workspace can't take a domain, parent or subdomain another workspace holds.
- **Archive domain**: set per newsletter in its settings (no redeploy). The platform owner gets an alert to point
  the domain at the app and attach it on the hosting side. `ARCHIVE_HOSTS` still works.
- **Account** (`/account`): name, password, "sign out everywhere".

### What the platform needs for this

1. **PLATFORM_FROM** (or ALERT_FROM): the sender of invitation and password-reset emails, on a verified domain.
   Without it the invite dialog gives the owner the link to share by hand.
2. **More AWS permissions** for the SES user (the dashboard only read before): `ses:CreateEmailIdentity`,
   `ses:PutEmailIdentityMailFromAttributes` and `ses:DeleteEmailIdentity`. Without them "Add domain" says so
   plainly and nothing is half-created.

### Looking at it locally

`npm run dev:demo` starts the whole app on a throwaway database with three seeded workspaces (an owner, an editor,
a suspended one, pending invitations, domains in different states). Nothing touches production or AWS, and
sending is off. The log-in details are printed when it starts.

## The platform console (Phase 4)

Only platform administrators see the **Platform** section of the menu; an administrator with no workspace sees
nothing else.

- **Overview** (`/platform`): workspaces, contacts, emails this month and the 30-day bounce rate across everyone, the
  shared SES account's quota and health, a **Needs attention** list that says why (past the pause limit, suspended,
  at or near a limit) and recent activity.
- **Workspaces** (`/platform/workspaces`): every client with their usage against limits and deliverability. On a
  phone each is a card.
- **A workspace** (`/platform/workspaces/<id>`): usage, deliverability, name and limits (editable), people and
  pending invitations, newsletters, domains and an activity log. **Suspend/Resume** stops or restores sending,
  public signups and the API, and **Assign domain** attaches a domain (including one created in SES by hand) to the
  workspace. There is no "open workspace": the console is configuration only.
- **Team** (`/platform/team`): the administrators. Invite someone by email (they get an administrator-only account,
  or the right added to their existing one), revoke pending invitations, remove an administrator. The last one can't
  be removed. Platform alerts go to every administrator (`ADMIN_EMAIL` is only the fallback when there is none).
- **New workspace**: a name, the first owner's email and optional limits. The owner gets an invitation by email, or a
  link to hand over when email isn't set up.

### What the overview shows

`/platform` has a **7 / 30 / 90 day** switch (in the address as `?range=`). Days are UTC dates, since it looks at
every client at once. Everything comes from data the platform already keeps; nothing extra is stored.

- **Cards**: workspaces, subscribers (with the net change in the period), emails sent, bounce rate (always the last
  30 days, because the pause limit is judged on that), open rate and click rate, and the estimated SES cost of the
  month. Open and click rates are estimates: some mail apps open emails on their own or hide opens.
- **Emails sent per day**, stacked by workspace (the biggest five, the rest as "Others"). Test emails never count.
- **Bounce rate and complaint rate**: a 7-day rolling rate with the pause limit drawn across it
  (`LIMITS.bounceRate`, `LIMITS.complaintRate`). A day with too few sends in its window draws nothing.
- **Subscribers** over the period: who joined and who left (an unsubscribe; a bounce counts only when it also
  unsubscribed the contact).
- **Needs attention** also flags a workspace that is **on pace to pass its monthly email limit**: this month's
  sends scaled to the whole month, shown only after three days of the month and some sending.
- **Sending problems**: sends that are paused, sends that have not moved for an hour, and emails that failed in the
  last 7 days, by workspace.
- **Top by volume**, **Fastest growing** and **Gone quiet** (no send for 30 days, or none since the first week).

The **Workspaces** list adds a 30-day trend line, the SES cost this month and the pace warning; a workspace's own
page has its daily chart, open/click rates and cost.

"Delivered" is not shown as a rate until Amazon SES reports delivery events: add the **Delivery** event type to the
`mailcheap` configuration set's event destination. Until then the overview says "Delivery not reported yet".

### Accounts, Domains and Activity

- **Accounts** (`/platform/accounts`): every login, the workspaces it belongs to and when it was last seen; search by
  email or name. Per account: send a password reset, sign out everywhere, disable or enable. A disabled account
  is signed out at once. You can't disable yourself or the only administrator who can still log in.
- **Domains** (`/platform/domains`): every client's sending domains with their state in SES, worst first (a domain still
  unverified after 3 days is flagged), and SES identities that belong to no workspace.
- **Activity** (`/platform/activity`): the full log, filtered by workspace and action, 50 at a time.

### Two-factor login

Anyone can turn on a second step for their login from **Account → Two-factor login**: a 6-digit code from an
authenticator app (Google Authenticator, 1Password, Authy...). Setup shows a QR code and the key to type in, asks for
the first code, then shows **10 recovery codes** once; each works one time if the phone is lost.

- **Platform administrators must have it.** Without it, every Platform page sends them to the account page to set it
  up, and they can't turn it off. `REQUIRE_ADMIN_2FA=false` in the environment is the emergency switch.
- **Login** is two steps: password, then `/login/verify`. The password alone starts no session; the step in between is
  a signed, five-minute cookie that can't be used as a session. It dies if the password changes or the account is
  disabled in between. Five wrong codes in 15 minutes stop further tries for that person.
- **An app code works once** (replaying a code seen over a shoulder is refused), within 30 seconds either side of now.
- **Stored safely:** the secret is encrypted with a key derived from `SESSION_SECRET` and recovery codes are keyed
  hashes, so a copy of the database alone is not enough. **Changing `SESSION_SECRET` makes every stored secret
  unreadable**: everyone with two-factor on would have to be reset (below). Plan that before rotating it.
- **Lost phone and recovery codes:** another administrator opens **Accounts → ⋯ → Remove two-factor login**. The
  person is signed out everywhere and sets it up again. If the only administrator is locked out, run on your own
  computer: `MONGODB_URI='...' node scripts/reset-2fa.mjs you@example.com`, then log in with the password.

### Safe sending (Phase A)

Every client sends through one shared Amazon SES account, so the platform protects it. All of this is per client, and
a platform administrator can see and change it from the client's page in the console.

- **Addresses that are refused** at signup (form and API) and import: typos of the big providers (`gmial.com`, with a
  "did you mean" hint), throwaway inboxes (a bundled list of about 10,000 domains from the CC0
  `disposable-email-domains` project, `lib/data/disposable-domains.js`), domains on the platform's own blocklist
  (**Domains → Blocked email domains**) and domains that can't receive email (a DNS lookup; `ADDRESS_CHECK_DNS=off`
  turns it off, and a failed lookup never blocks anyone). People already on a list are never turned away, and rows that
  record an unsubscribe, bounce or complaint are always kept. The API answers `422` with `reason` and `suggestion`.
- **Warm-up.** A new sender may send 200 emails a day, doubling every three days for the first month; after that, five
  times its busiest recent day (never under 2,000). A send reaches at most what the next three days allow (the most
  engaged people first; "Send to more" does the rest), each batch is queued with the delay for its day, and the batch
  sender enforces the amount again. Welcome and confirmation emails are not held. If its numbers are already close to the
  limits the amount stops growing. **Trusted sender** (client page → Sending speed) removes all of it, or set a daily
  amount of your own. The client sees where it stands on their overview.
- **New people go in a slice.** In a send to more than 200 people who have never had an email from the workspace, 5%
  (200 to 2,000) go first and the rest 3 hours later; the usual pause rules look at the first slice before the rest
  goes out.
- **Pauses and blocks.** A send pauses above 2% hard bounces (at least 5) or 0.08% spam complaints (at least 2) once 50
  are out. A whole workspace is **blocked** (suspended, with the reason, owners and platform told) above 5% bounces (at
  least 10) or 0.3% complaints (at least 3) over the last 7 days, checked when a bounce or complaint arrives and before
  each batch. Resuming it starts the count afresh from that moment.
- **Review of risky issues.** An issue with a link whose shown address differs from where it goes, a link to a
  program, a "verify your password" lure, crypto wallet secrets or a prize-with-a-fee scam waits in **Review** until an
  administrator approves or turns it down with a reason (the sender is emailed). A decision belongs to the exact text:
  any edit asks again. Welcome, confirmation and series emails that trip the scan can't be saved. Weaker signs
  (capitals, repeated `!`, "100% free", fake `Re:`, link shorteners) show as tips in the pre-send checks and never block.
  This is the one place an administrator reads a client's email, and only what was flagged; it is audited.

### Limits (all optional; empty means none)

| Limit | What it counts | What happens at the limit |
|---|---|---|
| Contacts | people who can be emailed (active, pending, dormant) | signups, the API and manual add stop; a CSV import adds as many new people as fit and says how many it left out |
| Emails per month | everything sent except test emails, from the 1st (UTC) | a send that won't fit is refused before it starts; one under way pauses and tells the owners; welcome and confirmation emails fail with the reason |
| Newsletters | how many the workspace has | a new one can't be created |

Workspace people see their own usage ("Your plan" on the overview) but never what an email costs you.

Everything an administrator does to a workspace or to the team is kept in an activity log (`AuditLog`).
