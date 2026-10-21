#!/usr/bin/env bash
# One guided run of the steps before deploying the workspace version:
#   1. back up the database into ./backups/   2. show what the migration would do   3. apply it, once you say yes
# It asks for the database connection string with the typing hidden, so it never lands in your shell history
# or on screen. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${MONGODB_URI:-}" ]; then
  read -r -s -p "Paste the database connection string (typing stays hidden), then press Enter: " MONGODB_URI
  echo
  export MONGODB_URI
fi
[ -n "$MONGODB_URI" ] || { echo "No connection string given."; exit 1; }

if [ -z "${ADMIN_EMAIL:-}" ]; then
  read -r -p "The email you log in to Mailcheap with (ADMIN_EMAIL in Hostinger): " ADMIN_EMAIL
  export ADMIN_EMAIL
fi

echo
echo "=== 1/3  Backing up the database ==="
node scripts/backup-db.mjs

echo
echo "=== 2/3  What the migration would do (nothing changes yet) ==="
node scripts/migrate-workspaces.mjs --dry-run

echo
if [ "${PREDEPLOY_ASSUME_YES:-}" = "1" ]; then
  answer="yes"
else
  read -r -p "Apply the migration now? Type yes to continue, anything else to stop: " answer
fi
if [ "$answer" != "yes" ]; then
  echo "Stopped. Only the backup was made; your data is unchanged."
  exit 0
fi

echo
echo "=== 3/3  Applying the migration ==="
node scripts/migrate-workspaces.mjs --yes

echo
echo "All done. Your backup is in the backups/ folder (it holds subscriber addresses: keep it private)."
