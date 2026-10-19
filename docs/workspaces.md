# Workspaces

One Mailcheap install serves many **workspaces**: each client, or each of the owner's own brands, with its
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
