# Deploying the workspace version

Do these in order. Nothing here changes the live site until step 6.

## 1. Allow the AWS user to add domains (once)

AWS console → IAM → Policies → `mailcheap-ses` → Edit → add this block to the `Statement` list → Save.
(Without it everything else works; only "Add domain" says the platform isn't allowed yet.)

```json
{
  "Effect": "Allow",
  "Action": [
    "ses:CreateEmailIdentity",
    "ses:PutEmailIdentityMailFromAttributes",
    "ses:DeleteEmailIdentity"
  ],
  "Resource": [
    "arn:aws:ses:eu-north-1:459369345908:identity/*",
    "arn:aws:ses:eu-north-1:459369345908:configuration-set/mailcheap"
  ]
}
```

## 2. PLATFORM_FROM (done)

`PLATFORM_FROM` = `Namag <alerts@abakelianavedis.com>` is set in Hostinger. It's the sender of password-reset
and invitation emails.

## 3. Back up the database

The free Atlas tier has no snapshots, so this copies every collection into plain files on your Mac.
In your own terminal (the connection string is in Hostinger → Environment variables → MONGODB_URI; type it
there, don't paste it into a chat):

```bash
cd ~/Projects/mailcheap
export MONGODB_URI='paste-the-connection-string-here'
node scripts/backup-db.mjs
```

It prints how many documents it copied and the folder (`backups/<date>/`). Keep that folder: it holds every
subscriber's address. To put it back into an empty database: `node scripts/backup-db.mjs --restore backups/<date>`.

## 4. Look at what the migration will do (changes nothing)

```bash
export ADMIN_EMAIL='your-admin-email'
export ADMIN_PASSWORD='your-admin-password'   # optional: without it your account is created at your first login
node scripts/migrate-workspaces.mjs --dry-run
```

## 5. Run the migration

```bash
node scripts/migrate-workspaces.mjs --yes
```

It's safe to run again. It ends with "Still without a workspace (should all be 0)". The live site keeps
working while it runs, because the current code ignores the new fields.

## 6. Deploy

Merge the `multi-tenant` branch into `main` and push. Hostinger rebuilds in a minute or two. You'll be logged
out once. Then check: log in, open Contacts, Campaigns and Domains, and send yourself a test email.

If something is wrong, revert the merge on `main` (the old code works with the migrated data) and tell me.
