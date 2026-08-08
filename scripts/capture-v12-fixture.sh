#!/usr/bin/env bash
# Capture the schema-version-12 fixture from a released 0.3.x binary.
#
# Every 0.3.0 through 0.3.8 release shipped SCHEMA_VERSION = 12. 0.4.0 migrates
# those installs to 17, and 017_b4_core.sql rebuilds section_activities with a
# one-way orphan delete. The fixture is what makes that path testable against a
# database a real release actually wrote, rather than one the test suite built
# from the same migration files it is checking.
#
# The emulator must be an AOSP google_apis image. adb root refuses to run on
# google_apis_playstore, and without root the app's private files are unreadable
# because the release APK is not debuggable.

set -euo pipefail

AVD="${AVD:-v12_fixture}"
RELEASE="${RELEASE:-0.3.8}"
REPO="${REPO:-evanjt/veloq}"
WORK="${WORK:-${TMPDIR:-/tmp}/v12-fixture}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/modules/veloqrs/rust/veloqrs/tests/fixtures/v12_demo.sql"
ADB="${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb"

mkdir -p "$WORK"

# Maestro is a JVM process and ignores TMPDIR. It unpacks its driver APK into
# java.io.tmpdir, and on a tmpfs with a per-user quota that fails as
# "Disk quota exceeded" long before the filesystem is full.
MAESTRO_TMP="${MAESTRO_TMP:-$HOME/.cache/maestro-tmp}"
mkdir -p "$MAESTRO_TMP"
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djava.io.tmpdir=$MAESTRO_TMP"

tag="$(grep -E '^tag.id' "$HOME/.android/avd/$AVD.avd/config.ini" | cut -d= -f2 | tr -d ' ')"
if [ "$tag" != "google_apis" ]; then
  echo "AVD $AVD uses '$tag'. adb root needs a plain google_apis image." >&2
  exit 1
fi

if [ ! -f "$WORK/veloq-$RELEASE.apk" ]; then
  gh release download "$RELEASE" -R "$REPO" -p "veloq-$RELEASE.apk" -D "$WORK"
fi

"$ADB" wait-for-device
"$ADB" root
sleep 3
"$ADB" wait-for-device
"$ADB" install -r "$WORK/veloq-$RELEASE.apk"

maestro test "$(dirname "$0")/../.maestro/upgrade/seed.yaml" --no-ansi

"$ADB" pull /data/data/com.veloq.app/files/routes.db "$WORK/v12.db"

version="$("${SQLITE3:-sqlite3}" "$WORK/v12.db" 'PRAGMA user_version;')"
if [ "$version" != "12" ]; then
  echo "Captured database is at user_version $version, expected 12." >&2
  exit 1
fi

# The capture is only safe to commit because demo mode fabricates its data. Fail
# loudly rather than let a real athlete's history through the way routes.db did.
foreign="$(sqlite3 "$WORK/v12.db" "SELECT COUNT(*) FROM activities WHERE id NOT LIKE 'demo-%'")"
if [ "$foreign" != "0" ]; then
  echo "$foreign activities are not demo-sourced. Refusing to write the fixture." >&2
  exit 1
fi
if sqlite3 "$WORK/v12.db" 'SELECT key, value FROM settings' | grep -qiE 'api_?key|bearer|secret|token'; then
  echo "settings holds credential-shaped values. Refusing to write the fixture." >&2
  exit 1
fi

{
  echo "-- Schema version 12 captured from veloq-$RELEASE.apk in demo mode."
  echo "-- Every 0.3.0 through 0.3.8 release shipped SCHEMA_VERSION = 12, so this is the"
  echo "-- state every live user upgrades from. Regenerate with scripts/capture-v12-fixture.sh."
  echo "--"
  echo "-- All ids are demo-*, no athlete id, no API key, no residential coordinates."
  echo "-- sqlite3 .dump omits user_version, so it is pinned at the end. Without that the"
  echo "-- replay looks like a fresh v0 database and the migration chain runs from scratch."
  sqlite3 "$WORK/v12.db" .dump
  echo "PRAGMA user_version=12;"
} > "$DEST"

echo "Wrote $DEST"
