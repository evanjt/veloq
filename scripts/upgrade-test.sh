#!/usr/bin/env bash
# Install a released build, seed it, upgrade in place, and prove the data survived.
#
# Maestro cannot install an app mid-flow (mobile-dev-inc/Maestro#1665, open since
# January 2024), so the upgrade is orchestrated here around two invocations.
#
# The assertion that matters is not "the app launched". persistent_engine_init
# quarantines a database it cannot open and recreates it, so a failed migration
# presents as a working app with an empty library. This script therefore compares
# the database either side of the upgrade and fails if a quarantine file appeared.
#
# Both APKs must be signed with the same key, or the second install fails with
# INSTALL_FAILED_UPDATE_INCOMPATIBLE. That gives two usable modes:
#
#   CI, against the real shipped binary. The release keystore is in secrets
#   (build.yml:202-213), so a release-signed branch build can upgrade a published
#   release directly:
#     NEW_APK=path/to/branch-release.apk scripts/upgrade-test.sh
#
#   Local, both sides from source. The release keystore is not on a dev machine,
#   so build the old and the new side with the same debug key and the signatures
#   match:
#     git worktree add ../v038 v0.3.8
#     (cd ../v038 && npx expo run:android --variant debug --no-install)
#     (npx expo run:android --variant debug --no-install)
#     APP_ID=com.veloq.app.dev \
#     FROM_APK=../v038/android/app/build/outputs/apk/debug/app-debug.apk \
#     NEW_APK=android/app/build/outputs/apk/debug/app-debug.apk \
#       scripts/upgrade-test.sh
#
# The local mode is the weaker of the two: it proves the migration path on a real
# device against a real previous build, but not against the exact bytes users
# installed. Run the CI mode before a release.

set -euo pipefail

FROM_RELEASE="${FROM_RELEASE:-0.3.8}"
REPO="${REPO:-evanjt/veloq}"
NEW_APK="${NEW_APK:-}"
APP_ID="${APP_ID:-com.veloq.app}"
WORK="${WORK:-${TMPDIR:-/tmp}/upgrade-test}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"
DB="/data/data/$APP_ID/files/routes.db"

mkdir -p "$WORK"

# Maestro is a JVM process and ignores TMPDIR. It unpacks its driver APK into
# java.io.tmpdir, and on a tmpfs with a per-user quota that fails as
# "Disk quota exceeded" long before the filesystem is full.
MAESTRO_TMP="${MAESTRO_TMP:-$HOME/.cache/maestro-tmp}"
mkdir -p "$MAESTRO_TMP"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djava.io.tmpdir=$MAESTRO_TMP"

if [ -z "$NEW_APK" ]; then
  echo "NEW_APK must point at an APK built from the branch under test," >&2
  echo "signed with the same key as FROM_APK. See the header for both modes." >&2
  exit 2
fi

FROM_APK="${FROM_APK:-}"
if [ -z "$FROM_APK" ]; then
  if [ ! -f "$WORK/veloq-$FROM_RELEASE.apk" ]; then
    gh release download "$FROM_RELEASE" -R "$REPO" -p "veloq-$FROM_RELEASE.apk" -D "$WORK"
  fi
  FROM_APK="$WORK/veloq-$FROM_RELEASE.apk"
fi

counts() {
  # Row counts for the tables a migration could damage, one per line.
  "$ADB" shell "sqlite3 $DB \
    'SELECT \"user_version=\" || (SELECT * FROM pragma_user_version);
     SELECT \"activities=\" || COUNT(*) FROM activities;
     SELECT \"sections=\" || COUNT(*) FROM sections;
     SELECT \"junction=\" || COUNT(*) FROM section_activities;
     SELECT \"routes=\" || COUNT(*) FROM route_groups;'" | tr -d '\r'
}

value_of() { grep "^$1=" | cut -d= -f2; }

"$ADB" wait-for-device
"$ADB" root >/dev/null
sleep 3
"$ADB" wait-for-device

"$ADB" uninstall "$APP_ID" >/dev/null 2>&1 || true
"$ADB" install "$FROM_APK"

# clearState would run `pm clear` and wipe the database this test exists to
# preserve, turning the whole run into a no-op that passes.
maestro test "$ROOT/.maestro/upgrade/seed.yaml" --no-ansi

before="$(counts)"
echo "before upgrade:"; echo "$before" | sed 's/^/  /'

activities_before="$(echo "$before" | value_of activities)"
if [ "${activities_before:-0}" -lt 1 ]; then
  echo "Seeding left no activities, so the upgrade assertion would prove nothing." >&2
  exit 1
fi

# -r keeps /data/data. Without it this reduces to a fresh-install test.
"$ADB" install -r "$NEW_APK"

maestro test "$ROOT/.maestro/upgrade/assert.yaml" --no-ansi

after="$(counts)"
echo "after upgrade:"; echo "$after" | sed 's/^/  /'

quarantined="$("$ADB" shell "ls /data/data/$APP_ID/files/ 2>/dev/null | grep -c 'corrupt' || true" | tr -d '\r')"
if [ "${quarantined:-0}" != "0" ]; then
  echo "FAIL: the engine quarantined the database and started fresh." >&2
  echo "The app will look healthy and the user's library will be empty." >&2
  exit 1
fi

fail=0
for table in activities sections routes; do
  b="$(echo "$before" | value_of "$table")"
  a="$(echo "$after" | value_of "$table")"
  if [ "$a" != "$b" ]; then
    echo "FAIL: $table went from $b to $a across the upgrade." >&2
    fail=1
  fi
done

# The junction is the one table an upgrade may legitimately shrink: migration 017
# filters rows whose activity no longer exists. It may never grow, and it may
# never empty while sections remain.
jb="$(echo "$before" | value_of junction)"
ja="$(echo "$after" | value_of junction)"
if [ "$ja" -gt "$jb" ]; then
  echo "FAIL: junction grew from $jb to $ja, which no migration should do." >&2
  fail=1
fi
if [ "$ja" -eq 0 ] && [ "$(echo "$after" | value_of sections)" -gt 0 ]; then
  echo "FAIL: every section lost its membership while the sections survived." >&2
  fail=1
fi

vb="$(echo "$before" | value_of user_version)"
va="$(echo "$after" | value_of user_version)"
if [ "$va" -le "$vb" ]; then
  echo "FAIL: schema version did not advance ($vb to $va), so no migration ran." >&2
  fail=1
fi

[ "$fail" -eq 0 ] || exit 1
echo "Upgrade $(basename "$FROM_APK") -> $(basename "$NEW_APK"): schema $vb to $va, data intact."
