#!/usr/bin/env bash
# Measure what Android Auto Backup restores onto a fresh install, with a stand-in app
# rather than a release build, on an emulator only.
#
# Two builds of one throwaway package, signed with the debug key:
#   wide    the older rules: fullBackupContent alone, carrying shared preferences, the
#           library file and its local copies directory, with no backup agent.
#   narrow  the current rules: fullBackupContent and dataExtractionRules carrying shared
#           preferences and the record zip, SecureStore and the agent's record excluded,
#           a backup agent and fullBackupOnly.
#
# Scenario old-set: wide is installed, its files written, backed up through LocalTransport,
# uninstalled, narrow installed and restored. It answers whether a backup set made under
# wider rules restores files the installed build's rules leave out.
# Scenario same-set: the same with narrow on both sides. It answers what a current backup
# brings back and whether the restored zip keeps the time it was written.
#
#   ANDROID_SERIAL=emulator-5600 scripts/restore-rules-probe/probe.sh
set -uo pipefail

# An emulator run still holds the device, so a second probe or a flow cannot reset it
# mid-measurement. Re-exec through the lock unless it is already held.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/../with-device-lock.sh" "$0" "$@"
fi

[ -n "${ANDROID_SERIAL:-}" ] || { echo "probe: set ANDROID_SERIAL to an emulator" >&2; exit 2; }
case "$ANDROID_SERIAL" in emulator-*) ;; *) echo "probe: $ANDROID_SERIAL is not an emulator" >&2; exit 2 ;; esac
[ "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1 ] || { echo "probe: ro.kernel.qemu is not 1" >&2; exit 2; }

SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
PLATFORM="$SDK/platforms/$(ls "$SDK/platforms" | sort -V | tail -1)/android.jar"
JDK="${PROBE_JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"
PKG="org.example.restoreprobe"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# Written before the backup: the record zip's time, so a restore that resets it shows.
ZIP_MTIME="2026-10-01 12:00:00"

write_sources() {
  local dir="$1" variant="$2"
  mkdir -p "$dir/res/xml" "$dir/src/org/example/restoreprobe"
  cat >"$dir/src/org/example/restoreprobe/Main.java" <<'JAVA'
package org.example.restoreprobe;
public class Main extends android.app.Activity {
  @Override protected void onCreate(android.os.Bundle b) { super.onCreate(b); finish(); }
}
JAVA
  if [ "$variant" = wide ]; then
    cat >"$dir/res/xml/rules.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <include domain="sharedpref" path="." />
  <include domain="file" path="routes.db" />
  <include domain="file" path="backups/" />
  <exclude domain="sharedpref" path="SecureStore" />
</full-backup-content>
XML
    cat >"$dir/AndroidManifest.xml" <<XML
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$PKG">
  <application android:allowBackup="true" android:debuggable="true"
      android:fullBackupContent="@xml/rules" android:label="probe">
    <activity android:name=".Main" android:exported="true" />
  </application>
</manifest>
XML
  else
    cat >"$dir/src/org/example/restoreprobe/Agent.java" <<'JAVA'
package org.example.restoreprobe;
public class Agent extends android.app.backup.BackupAgent {
  @Override public void onBackup(android.os.ParcelFileDescriptor o, android.app.backup.BackupDataOutput d, android.os.ParcelFileDescriptor n) {}
  @Override public void onRestore(android.app.backup.BackupDataInput d, int v, android.os.ParcelFileDescriptor n) {}
}
JAVA
    cat >"$dir/res/xml/rules.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <include domain="sharedpref" path="." />
  <include domain="file" path="veloq-decisions.zip" />
  <exclude domain="sharedpref" path="SecureStore" />
  <exclude domain="sharedpref" path="veloq_auto_backup.xml" />
</full-backup-content>
XML
    cat >"$dir/res/xml/extraction.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="." />
    <include domain="file" path="veloq-decisions.zip" />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="veloq_auto_backup.xml" />
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="." />
    <include domain="file" path="veloq-decisions.zip" />
    <exclude domain="sharedpref" path="SecureStore" />
    <exclude domain="sharedpref" path="veloq_auto_backup.xml" />
  </device-transfer>
</data-extraction-rules>
XML
    cat >"$dir/AndroidManifest.xml" <<XML
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$PKG">
  <application android:allowBackup="true" android:debuggable="true"
      android:fullBackupContent="@xml/rules" android:dataExtractionRules="@xml/extraction"
      android:backupAgent=".Agent" android:fullBackupOnly="true" android:label="probe">
    <activity android:name=".Main" android:exported="true" />
  </application>
</manifest>
XML
  fi
}

build() {
  local variant="$1" dir="$WORK/$1"
  write_sources "$dir" "$variant"
  "$BT/aapt2" compile --dir "$dir/res" -o "$dir/res.zip" || return 1
  "$BT/aapt2" link -I "$PLATFORM" --manifest "$dir/AndroidManifest.xml" "$dir/res.zip" \
    --min-sdk-version 29 --target-sdk-version 35 -o "$dir/unsigned.apk" || return 1
  mkdir -p "$dir/classes" "$dir/dex"
  javac -source 11 -target 11 -nowarn -classpath "$PLATFORM" -d "$dir/classes" \
    $(find "$dir/src" -name '*.java') 2>/dev/null || return 1
  "$BT/d8" --lib "$PLATFORM" --min-api 29 --output "$dir/dex" $(find "$dir/classes" -name '*.class') || return 1
  (cd "$dir/dex" && zip -q "$dir/unsigned.apk" classes.dex) || return 1
  "$BT/zipalign" -f 4 "$dir/unsigned.apk" "$dir/aligned.apk" || return 1
  "$BT/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android \
    --key-pass pass:android --ks-key-alias androiddebugkey --out "$WORK/$variant.apk" "$dir/aligned.apk"
}

as_app() { adb shell run-as "$PKG" sh -c "'$*'" | tr -d '\r'; }

seed_files() {
  as_app "mkdir -p files/backups shared_prefs"
  as_app "echo library > files/routes.db; echo copy > files/backups/copy.db"
  as_app "echo record > files/veloq-decisions.zip; touch -d \"$ZIP_MTIME\" files/veloq-decisions.zip"
  as_app "echo \"<map><string name=\\\"k\\\">v</string></map>\" > shared_prefs/settings.xml"
  as_app "echo \"<map><string name=\\\"t\\\">secret</string></map>\" > shared_prefs/SecureStore.xml"
  as_app "echo \"<map><long name=\\\"backedUpAt\\\" value=\\\"1\\\" /></map>\" > shared_prefs/veloq_auto_backup.xml"
}

listing() { as_app "find files shared_prefs -type f -exec stat -c %y\\ %n {} +" | awk '{print "   " $1 "T" substr($2, 1, 8), $4}' | sort -k2; }

token() { adb shell dumpsys backup | tr -d '\r' | sed -n 's/^Current: *\([0-9a-fA-F]*\).*/\1/p' | head -1; }

scenario() {
  local name="$1" first="$2" second="$3"
  echo "== $name: back up under $first, restore under $second"
  adb uninstall "$PKG" >/dev/null 2>&1
  adb install "$WORK/$first.apk" | tr -d '\r' | sed 's/^/   install: /'
  adb shell am start -W -n "$PKG/.Main" >/dev/null 2>&1
  seed_files
  echo "   before the backup:"; listing
  adb shell am force-stop "$PKG"; adb shell cmd package unstop "$PKG" >/dev/null 2>&1
  adb shell bmgr backupnow "$PKG" | tr -d '\r' | grep -E "result|Backup finished" | sed 's/^/   /'
  local tok; tok=$(token)
  echo "   current set token: ${tok:-none}"
  # Readable only where adb runs as root, as on a google_apis emulator after `adb root`.
  echo "   the set holds:"
  adb shell "strings /data/data/com.android.localtransport/files/1/_full/$PKG" 2>/dev/null |
    tr -d '\r' | grep '^apps/' | sed 's/^/     /'
  adb uninstall "$PKG" | tr -d '\r' | sed 's/^/   uninstall: /'
  adb install "$WORK/$second.apk" | tr -d '\r' | sed 's/^/   install: /'
  sleep 5
  echo "   after the install, before any explicit restore:"; listing
  adb shell bmgr restore "$tok" "$PKG" | tr -d '\r' | grep -iE "restore|done|error" | sed 's/^/   /'
  sleep 3
  echo "   after bmgr restore:"; listing
}

build wide && build narrow || { echo "probe: build failed" >&2; exit 1; }
adb shell bmgr enable true >/dev/null
PREV=$(adb shell bmgr list transports | tr -d '\r' | sed -n 's/^ *\* *//p')
adb shell bmgr transport com.android.localtransport/.LocalTransport | tr -d '\r' | sed 's/^/   /'
echo "   autorestore: $(adb shell settings get secure backup_auto_restore | tr -d '\r')"
scenario old-set wide narrow
scenario same-set narrow narrow
adb uninstall "$PKG" >/dev/null 2>&1
[ -z "$PREV" ] || adb shell bmgr transport "$PREV" >/dev/null
