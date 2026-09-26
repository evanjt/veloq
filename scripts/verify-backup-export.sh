#!/usr/bin/env bash
# Pull the most recent .veloqdb backup from the app cache and verify it opens
# as a valid SQLite database with the expected tables.
#
# Run after the Maestro backup flow. Requires sqlite3 + adb in PATH.
set -uo pipefail

# One measurement at a time against one handset: `docket start` locks the item
# and not the phone, and a second session resetting or relaunching the app
# mid-run lands in this run's numbers (B1034). Re-exec through the lock unless
# it is already held, so running this by hand takes it too.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi


PKG="com.veloq.app.dev"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Backups land in the app's backups/ directory under documentDirectory.
BASE=$(adb shell "run-as $PKG ls -1t files/backups 2>/dev/null" | tr -d '\r' | grep -E '\.veloqdb$' | head -n1 || true)
if [ -z "${BASE:-}" ]; then
  # Fallback - check cache and tmp for auto-backup staging files
  BASE=$(adb shell "run-as $PKG ls -1t cache/ 2>/dev/null" | tr -d '\r' | grep -E 'veloq.*\.veloqdb$' | head -n1 || true)
  [ -z "${BASE:-}" ] && { echo "FAIL: no .veloqdb found in files/backups or cache/"; exit 1; }
  SRC="cache/$BASE"
else
  SRC="files/backups/$BASE"
fi

echo "Found: $SRC"
adb shell "run-as $PKG cat $SRC" > "$WORK/backup.veloqdb"
SIZE=$(stat -c%s "$WORK/backup.veloqdb")
echo "Pulled $SIZE bytes"

if [ "$SIZE" -lt 4096 ]; then
  echo "FAIL: file too small ($SIZE bytes) - likely not a real SQLite database"
  exit 1
fi

TABLES=$(sqlite3 "$WORK/backup.veloqdb" ".tables" 2>&1) || {
  echo "FAIL: not a valid SQLite database"
  echo "$TABLES"
  exit 1
}

echo "Tables: $TABLES"

for t in activities sections section_activities activity_indicators; do
  if ! echo "$TABLES" | grep -qw "$t"; then
    echo "FAIL: missing expected table: $t"
    exit 1
  fi
done

COUNT=$(sqlite3 "$WORK/backup.veloqdb" "SELECT COUNT(*) FROM activities;" 2>/dev/null || echo "-1")
echo "activities rows: $COUNT"
if [ "$COUNT" -lt 1 ]; then
  echo "FAIL: activities table empty - expected demo fixtures"
  exit 1
fi

echo "PASS: valid SQLite backup, $COUNT activity rows, $SIZE bytes"
