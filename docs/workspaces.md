# Workspaces

One Namag install serves many **workspaces**: each client, or each of the owner's own brands, with its
own newsletters, contacts, campaigns, stats, API keys, sending domains and logins. A person in one workspace
can't see or change another's.

## Who can do what

- **Platform owner** (`User.isPlatformAdmin`): uses every workspace with the owner's rights. The first one
  is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` at their first login (or by the migration). After that the
  database decides: changing `ADMIN_PASSWORD` in the environment changes nothing.
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

Only the platform owner sees the **Platform** section of the menu.

- **Overview** (`/platform`): workspaces, contacts, emails this month and the 30-day bounce rate across everyone, the
  shared SES account's quota and health, a **Needs attention** list that says why (past the pause limit, suspended,
  at or near a limit) and recent activity.
- **Workspaces** (`/platform/workspaces`): every client with their usage against limits and deliverability. On a
  phone each is a card.
- **A workspace** (`/platform/workspaces/<id>`): usage, deliverability, name and limits (editable), people and
  pending invitations, newsletters, domains and an activity log. **Open workspace** steps into it as an owner;
  **Suspend/Resume** stops or restores sending, public signups and the API.
- **New workspace**: a name, the first owner's email and optional limits. The owner gets an invitation by email, or a
  link to hand over when email isn't set up.

### Limits (all optional; empty means none)

| Limit | What it counts | What happens at the limit |
|---|---|---|
| Contacts | people who can be emailed (active, pending, dormant) | signups, the API and manual add stop; a CSV import adds as many new people as fit and says how many it left out |
| Emails per month | everything sent except test emails, from the 1st (UTC) | a send that won't fit is refused before it starts; one under way pauses and tells the owners; welcome and confirmation emails fail with the reason |
| Newsletters | how many the workspace has | a new one can't be created |

Workspace people see their own usage ("Your plan" on the overview) but never what an email costs you.

Everything the platform owner does to a workspace, and every time they step into one they aren't a member of, is
kept in an activity log (`AuditLog`).
