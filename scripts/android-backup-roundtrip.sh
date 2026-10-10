#!/usr/bin/env bash
# Prove Android Auto Backup carries the record zip there and back, once per release.
#
# The backup agent records what Android did, and only a real round trip proves
# the rules files, the agent and the transport work together. Against the dev
# build on a test handset holding a real library:
#
#   1. Backup Manager is on and the Google transport is selected.
#   2. The record zip exists, and its SHA-256 is taken.
#   3. `bmgr backupnow`, then the agent's record must show a new backup.
#   4. The zip alone is deleted, and `bmgr restore` runs with the current token.
#   5. The zip is back byte-identical and the agent recorded the restore.
#
# It ends on one line, PASS with the payload size against the 25 MB cap, or
# FAIL naming the step. It never uninstalls or clears the app, which would
# wipe the library. A restore leaves the rest of the app's data alone because
# the manifest names a backup agent, and step 3 is what proves the agent is
# installed, so nothing is deleted before it passes. A zip the restore did not
# bring back is put back from the copy taken at step 2.
#
#   ANDROID_SERIAL=<test handset> scripts/android-backup-roundtrip.sh
#
# VELOQ_PROTECTED_HANDSETS is a comma-separated list of serials or
# `ro.product.model` values this must never touch, such as a personal phone.
set -uo pipefail

if [ -z "${ANDROID_SERIAL:-}" ]; then
  echo "android-backup-roundtrip: set ANDROID_SERIAL to the test handset; this deletes app data on it" >&2
  exit 2
fi

# One thing at a time against one handset: the backup and the restore both stop
# the app, so a measurement in another session loses it mid-run.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

PKG="com.veloq.app.dev"
ZIP="files/veloq-decisions.zip"
RECORD="shared_prefs/veloq_auto_backup.xml"
GOOGLE_TRANSPORT="com.google.android.gms/.backup.BackupTransportService"
CAP_BYTES=$((25 * 1024 * 1024))
POLLS=30

MODEL=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r')
IFS=',' read -r -a PROTECTED <<<"${VELOQ_PROTECTED_HANDSETS:-}"
for name in ${PROTECTED[@]+"${PROTECTED[@]}"}; do
  if [ -n "$name" ] && { [ "$name" = "$ANDROID_SERIAL" ] || [ "$name" = "$MODEL" ]; }; then
    echo "android-backup-roundtrip: $ANDROID_SERIAL ($MODEL) is protected, refusing" >&2
    exit 2
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

log() { echo "android-backup-roundtrip: $*" >&2; }

fail() {
  echo "FAIL step $1: $2"
  exit 1
}

sha() { sha256sum "$1" | cut -d' ' -f1; }

# One value from the agent's record, empty when it holds none.
recorded() {
  sed -n "s/.*<long name=\"$1\" value=\"\([0-9-]*\)\".*/\1/p" "$WORK/record.xml" | head -1
}

read_record() {
  adb exec-out run-as "$PKG" cat "$RECORD" >"$WORK/record.xml" 2>/dev/null || : >"$WORK/record.xml"
}

when() {
  date -u -d "@$(($1 / 1000))" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "$1"
}

# One string, so the redirect runs inside `run-as` rather than in the shell adb opens.
put_back() {
  adb exec-in "run-as $PKG sh -c 'cat > $ZIP'" <"$WORK/before.zip"
}

log "1. Backup Manager and transport on $ANDROID_SERIAL ($MODEL)"
if ! adb shell bmgr enabled | tr -d '\r' | grep -q 'currently enabled'; then
  fail 1 "Backup Manager is disabled; enable it with adb shell bmgr enable true"
fi
SELECTED=$(adb shell bmgr list transports | tr -d '\r' | sed -n 's/^ *\* *//p')
if [ "$SELECTED" != "$GOOGLE_TRANSPORT" ]; then
  fail 1 "the selected transport is ${SELECTED:-none}, not $GOOGLE_TRANSPORT; adb shell bmgr transport $GOOGLE_TRANSPORT"
fi

# Stopped so it does not rewrite the zip between the steps.
adb shell am force-stop "$PKG"

log "2. The record zip"
LISTED=$(adb shell run-as "$PKG" ls "$ZIP" 2>&1 | tr -d '\r')
case "$LISTED" in
*"not debuggable"* | *"unknown package"*)
  fail 2 "run-as cannot read $PKG ($LISTED); install a debug build with npm run android:debug"
  ;;
"$ZIP") ;;
*) fail 2 "no $ZIP on the handset; turn on automatic backup in Veloq and let it write one" ;;
esac
adb exec-out run-as "$PKG" cat "$ZIP" >"$WORK/before.zip"
BEFORE_SHA=$(sha "$WORK/before.zip")
ZIP_BYTES=$(wc -c <"$WORK/before.zip" | tr -d ' ')
[ "$ZIP_BYTES" -gt 0 ] || fail 2 "$ZIP read back empty"
log "   $ZIP_BYTES bytes, sha256 $BEFORE_SHA"

read_record
BACKED_BEFORE=$(recorded backedUpAt)
QUOTA_BEFORE=$(recorded quotaExceededAt)
RESTORED_BEFORE=$(recorded restoredAt)

log "3. bmgr backupnow"
adb shell bmgr backupnow "$PKG" | tr -d '\r' | sed 's/^/   /' >&2
BACKED_AT=""
for _ in $(seq 1 "$POLLS"); do
  read_record
  BACKED_AT=$(recorded backedUpAt)
  QUOTA_AT=$(recorded quotaExceededAt)
  [ -n "$BACKED_AT" ] && [ "$BACKED_AT" != "$BACKED_BEFORE" ] && break
  if [ -n "$QUOTA_AT" ] && [ "$QUOTA_AT" != "$QUOTA_BEFORE" ]; then
    fail 3 "Android dropped the payload, $(recorded quotaExceededBytes) bytes over the $(recorded quotaBytes) byte quota"
  fi
  sleep 1
done
if [ -z "$BACKED_AT" ] || [ "$BACKED_AT" = "$BACKED_BEFORE" ]; then
  fail 3 "the backup agent did not record a backup (last ${BACKED_BEFORE:-never}); is this build's agent in the manifest?"
fi
PAYLOAD_BYTES=$(recorded backedUpBytes)
log "   backed up $(when "$BACKED_AT"), $PAYLOAD_BYTES bytes"

log "4. Delete the zip and restore"
TOKEN=$(adb shell dumpsys backup | tr -d '\r' | sed -n 's/^Current: *\([0-9a-fA-F]*\).*/\1/p' | head -1)
if [ -z "$TOKEN" ] || [ "$TOKEN" = 0 ]; then
  fail 4 "dumpsys backup names no current backup set"
fi
adb shell run-as "$PKG" rm "$ZIP"
adb shell bmgr restore "$TOKEN" "$PKG" | tr -d '\r' | sed 's/^/   /' >&2

log "5. Compare"
AFTER_SHA=""
RESTORED_AT=""
for _ in $(seq 1 "$POLLS"); do
  read_record
  RESTORED_AT=$(recorded restoredAt)
  if [ -n "$RESTORED_AT" ] && [ "$RESTORED_AT" != "$RESTORED_BEFORE" ]; then break; fi
  sleep 1
done
if [ "$(adb shell run-as "$PKG" ls "$ZIP" 2>&1 | tr -d '\r')" = "$ZIP" ]; then
  adb exec-out run-as "$PKG" cat "$ZIP" >"$WORK/after.zip"
  AFTER_SHA=$(sha "$WORK/after.zip")
fi
if [ -z "$AFTER_SHA" ]; then
  put_back
  fail 5 "the restore did not bring $ZIP back; the copy from step 2 was put back"
fi
if [ "$AFTER_SHA" != "$BEFORE_SHA" ]; then
  put_back
  fail 5 "the restored $ZIP is not byte-identical (sha256 $AFTER_SHA, was $BEFORE_SHA); the copy from step 2 was put back"
fi
if [ -z "$RESTORED_AT" ] || [ "$RESTORED_AT" = "$RESTORED_BEFORE" ]; then
  fail 5 "$ZIP came back but the backup agent recorded no restore"
fi

MB=$(awk -v b="$PAYLOAD_BYTES" 'BEGIN { printf "%.1f", b / 1048576 }')
VERDICT="payload $PAYLOAD_BYTES bytes of the 25 MB cap ($MB MB), zip $ZIP_BYTES bytes"
[ "$PAYLOAD_BYTES" -le "$CAP_BYTES" ] || VERDICT="$VERDICT, over the cap"
echo "PASS: $VERDICT, backed up $(when "$BACKED_AT"), restored $(when "$RESTORED_AT")"
