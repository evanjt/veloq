#!/usr/bin/env bash
# Upgrade a simulator install to a newer build and read the library back. The library may
# start in Documents (a build before the move) or in the App Group; it must end in the App
# Group with every activity and no quarantine file, and a second launch must find it there.
#
#   scripts/ios-route-db-upgrade-probe.sh OLD.app NEW.app [ACTIVITIES]
#
# Runs on a Mac with Xcode. It creates a simulator of its own and deletes it at
# the end (KEEP_SIMULATOR=1 keeps it), so no other simulator is touched.
#
# A signed-out build opens no database, so once the old build is up the probe
# waits while someone enters demo mode on the simulator it names (the
# `login-demo-button` on the sign-in screen), or runs DEMO_CMD with UDID exported
# when that is set, which writes the demo library to
# Documents/routes.db. The probe then adds
# ACTIVITIES synthetic activities to it, the second half of them committed to
# the write-ahead log only, so the count after the move proves the journal
# travelled with the main file. It installs the new build over the old one,
# launches it, and reads both directories and the activity count. A second
# launch must find the library where the first left it. Demo mode does not survive a relaunch,
# so a signed-out new build never opens the database and the probe then proves the files came
# through untouched. REENTER_DEMO=1 runs DEMO_CMD again after each launch of the new build so
# the engine opens the library; entering demo mode deletes a library it did not seed, so the
# synthetic activities are gone afterwards and the counts then differ by exactly those.

set -euo pipefail

OLD_APP=${1:?old .app path}
NEW_APP=${2:?new .app path}
ACTIVITIES=${3:-40}
BUNDLE=com.veloq.app
GROUP=group.com.veloq.app
WAIT_SECS=${WAIT_SECS:-60}

bundle_id() { /usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$1/Info.plist"; }
for app in "$OLD_APP" "$NEW_APP"; do
  if [[ $(bundle_id "$app") != "$BUNDLE" ]]; then
    echo "error: $app is not $BUNDLE" >&2
    exit 2
  fi
done

# The first available iOS runtime that accepts the device type, newest first, so the probe
# follows whatever the host's Xcode ships. DEVICE_TYPE and RUNTIME pin either.
DEVICE_TYPE=${DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max}
UDID=""
if [[ -n ${RUNTIME:-} ]]; then
  runtimes=$RUNTIME
else
  runtimes=$(xcrun simctl list runtimes available | awk '/^iOS / { print $NF }' | sort -r)
fi
for runtime in $runtimes; do
  if UDID=$(xcrun simctl create "route-db-upgrade-probe" "$DEVICE_TYPE" "$runtime" 2>/dev/null); then
    break
  fi
  UDID=""
done
if [[ -z $UDID ]]; then
  echo "error: no available iOS runtime accepts $DEVICE_TYPE" >&2
  exit 2
fi
cleanup() {
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  if [[ ${KEEP_SIMULATOR:-0} != 1 ]]; then xcrun simctl delete "$UDID" || true; fi
}
trap cleanup EXIT
echo "simulator $UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

docs() { echo "$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents"; }
group() { xcrun simctl get_app_container "$UDID" "$BUNDLE" "$GROUP"; }

# Every routes.db file in a directory, with its size, or "(none)".
list_db() {
  local found
  found=$(cd "$1" 2>/dev/null && ls -l routes.db* 2>/dev/null | awk '{print $5, $NF}') || true
  echo "${found:-(none)}" | sed 's/^/    /'
}

report() {
  echo "  Documents ($(docs)):"
  list_db "$(docs)"
  local g
  g=$(group 2>/dev/null) || g=""
  if [[ -n $g ]]; then
    echo "  App Group ($g):"
    list_db "$g"
  else
    echo "  App Group: no container"
  fi
}

wait_for() {
  local what=$1 i
  for ((i = 0; i < WAIT_SECS; i++)); do
    if eval "$what"; then return 0; fi
    sleep 1
  done
  return 1
}

# The directory holding routes.db: Documents for a build that has not moved it yet, else
# the App Group. Empty when neither has one.
library_dir() {
  if [[ -f "$(docs)/routes.db" ]]; then
    docs
  elif [[ -f "$(group 2>/dev/null)/routes.db" ]]; then
    group
  fi
}

# Quarantine and corruption leftovers beside the library, in either directory.
quarantined() {
  local d
  for d in "$(docs)" "$(group 2>/dev/null)"; do
    [[ -n $d ]] && find "$d" -maxdepth 2 \( -iname '*quarantine*' -o -iname '*corrupt*' \) 2>/dev/null
  done
}

# Read-only, so reading never checkpoints the journal it is meant to observe.
count() {
  /usr/bin/python3 -c 'import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print(db.execute("SELECT COUNT(*) FROM activities").fetchone()[0])' "$1/routes.db"
}

echo "== old build"
xcrun simctl install "$UDID" "$OLD_APP"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
enter_demo() {
  if [[ -n ${DEMO_CMD:-} && ( ${1:-} == old || ${REENTER_DEMO:-0} == 1 ) ]]; then
    echo "  entering demo mode on simulator $UDID with DEMO_CMD"
    UDID=$UDID bash -c "$DEMO_CMD"
  elif [[ ${1:-} == old ]]; then
    echo "  enter demo mode on simulator $UDID now"
  fi
}
enter_demo old
WAIT_SECS=${OLD_WAIT_SECS:-300} wait_for '[[ -n "$(library_dir)" ]]' \
  || { echo "error: old build made no routes.db in Documents or the App Group" >&2; exit 1; }
sleep 10
xcrun simctl terminate "$UDID" "$BUNDLE" || true
sleep 2

OLD_DIR=$(library_dir)
echo "  library found in $OLD_DIR"
HALF=$((ACTIVITIES / 2))
/usr/bin/python3 - "$OLD_DIR/routes.db" "$ACTIVITIES" "$HALF" <<'PY'
import os, sqlite3, sys

path, total, half = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
db = sqlite3.connect(path, isolation_level=None)
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA wal_autocheckpoint=0")

def add(lo, hi):
    db.execute("BEGIN")
    for i in range(lo, hi):
        db.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,"
            " start_date, name, distance_meters, duration_secs)"
            " VALUES (?, 'Ride', 46.50, 46.52, 6.60, 6.63, ?, ?, 12000.0, 1800)",
            (f"probe-{i:04d}", 1_700_000_000 + i * 86_400, f"Probe ride {i}"),
        )
    db.execute("COMMIT")

add(0, half)
db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
add(half, total)
# Leave without closing, so the second half stays in the -wal as a killed
# process would leave it.
os._exit(0)
PY

BEFORE=$(count "$OLD_DIR")
echo "  activities before upgrade: $BEFORE ($HALF of them checkpointed, the rest in the -wal at the time of the upgrade)"
report

echo "== new build, first launch"
xcrun simctl install "$UDID" "$NEW_APP"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
enter_demo
sleep "${LAUNCH_SECS:-20}"
sleep 10
xcrun simctl terminate "$UDID" "$BUNDLE" || true
sleep 2
report
FIRST_DIR=$(library_dir)
FIRST=$(count "$FIRST_DIR")
echo "  activities after first launch: $FIRST (read from $FIRST_DIR)"

echo "== new build, second launch"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
enter_demo
sleep 15
xcrun simctl terminate "$UDID" "$BUNDLE" || true
sleep 2
report
SECOND_DIR=$(library_dir)
SECOND=$(count "$SECOND_DIR")
echo "  activities after second launch: $SECOND (read from $SECOND_DIR)"

echo "== result"
echo "  before=$BEFORE first=$FIRST second=$SECOND"
echo "  library: $OLD_DIR -> $FIRST_DIR -> $SECOND_DIR"
STRAY=$(quarantined)
echo "  quarantine files: ${STRAY:-none}"
if [[ $FIRST_DIR == "$(group 2>/dev/null)" && $FIRST_DIR == "$SECOND_DIR" \
  && $BEFORE == "$FIRST" && $FIRST == "$SECOND" && -z $STRAY \
  && ! -e "$(docs)/routes.db" && ! -e "$(docs)/routes.db-wal" && ! -e "$(docs)/routes.db-shm" && ! -e "$(docs)/routes.db-journal" ]]; then
  echo "  PASS: the library kept its rows, sits in the App Group and stayed there"
else
  echo "  FAIL"
  exit 1
fi
