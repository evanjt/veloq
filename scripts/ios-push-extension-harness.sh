#!/usr/bin/env bash
# Run the push extension's own Swift on a simulator, against the App Group
# database and the shared keychain group, and print what each push posts.
#
#   VELOQ_API_KEY=... VELOQ_ATHLETE_ID=... scripts/ios-push-extension-harness.sh
#
# Runs on a Mac with Xcode and the Rust iOS simulator target. It creates a
# simulator of its own and deletes it at the end (KEEP_SIMULATOR=1 keeps it).
# The credential comes from the environment and nothing else.
# VELOQ_ACTIVITY_ID picks the ride; unset, it is the athlete's newest activity
# with a GPS track.
#
# What it proves: the four files under `push/ios/VeloqPushExtension/`, compiled
# unchanged into a second bundle beside the engine's static library, read the
# credential an app wrote in expo-secure-store's shape under the App Group,
# open the database in the group container, reach the engine and the network,
# and post what the engine answered. The host app constructs
# `NotificationService` and calls `didReceive` itself, because `simctl push`
# never invokes a service extension.
#
# What it does not prove: APNs delivery and `mutable-content` reaching the
# phone, the thirty-second and memory budgets of an extension process, and the
# keychain of a locked phone after a reboot. Those stay device work.
#
# Kept out of CI: it needs a real key and a Mac.

set -euo pipefail

: "${VELOQ_API_KEY:?set VELOQ_API_KEY to an intervals.icu API key}"
: "${VELOQ_ATHLETE_ID:?set VELOQ_ATHLETE_ID to the athlete that key belongs to}"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCES="$ROOT/push/ios/VeloqPushExtension"
BUNDLE=com.example.pushharness
TEAM=ABCDE12345
# The extension's code names the real group, so the host has to carry it.
GROUP=group.com.veloq.app
WORK=$(mktemp -d)

# The server's visible content for an activity event, as `visibleContentForEvent`
# in `oauth-proxy/src/worker.ts` writes it.
SERVER_TITLE="Activity Recorded"
SERVER_BODY="New activity received"

if [[ -z ${VELOQ_ACTIVITY_ID:-} ]]; then
  VELOQ_ACTIVITY_ID=$(curl -fsS -u "API_KEY:$VELOQ_API_KEY" \
    "https://intervals.icu/api/v1/athlete/$VELOQ_ATHLETE_ID/activities?oldest=$(date -v-90d +%F)&newest=$(date +%F)" |
    /usr/bin/python3 -c 'import json, sys
for a in json.load(sys.stdin):
    if "latlng" in (a.get("stream_types") or []):
        print(a["id"])
        break')
fi
[[ -n $VELOQ_ACTIVITY_ID ]] || { echo "error: no activity with a GPS track in the last 90 days" >&2; exit 1; }
echo "activity $VELOQ_ACTIVITY_ID"

echo "building the engine for the simulator"
node "$ROOT/modules/veloqrs/scripts/build-rust.js" ios --slice iphonesimulator:arm64 --out "$WORK/rust"

UDID=$(xcrun simctl create "push-extension-harness" \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max \
  com.apple.CoreSimulator.SimRuntime.iOS-26-2)
cleanup() {
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  if [[ ${KEEP_SIMULATOR:-0} != 1 ]]; then xcrun simctl delete "$UDID" || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
echo "simulator $UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null

cat >"$WORK/main.swift" <<'SWIFT'
import Foundation
import Security
import UserNotifications

let environment = ProcessInfo.processInfo.environment
let arguments = Array(CommandLine.arguments.dropFirst())
let keys = ["intervals_athlete_id", "intervals_api_key", "intervals_access_token"]

// The app's group, not the extension's constant, so a mismatch between the
// two reads as a write that worked and a read that found nothing.
let appAccessGroup = environment["VELOQ_APP_ACCESS_GROUP"] ?? ""

// expo-secure-store's query(with:options:requireAuthentication:), as
// `credentialKeychain.ts` writes it: the shared group, no authentication.
func query(_ key: String, service: String) -> [String: Any] {
  let encoded = Data(key.utf8)
  return [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrGeneric as String: encoded,
    kSecAttrAccount as String: encoded,
    kSecAttrAccessGroup as String: appAccessGroup,
  ]
}

func clear() {
  for key in keys {
    for service in ["app:no-auth", "app:auth", "app"] {
      SecItemDelete(query(key, service: service) as CFDictionary)
    }
  }
}

func write(_ key: String, _ value: String) {
  var q = query(key, service: "app:no-auth")
  q[kSecValueData as String] = Data(value.utf8)
  q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  print("  write \(key): status \(SecItemAdd(q as CFDictionary, nil))")
}

func container() -> URL? {
  FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: VeloqPaths.appGroup)
}

switch arguments.first ?? "" {
case "seed":
  clear()
  write("intervals_athlete_id", environment["VELOQ_ATHLETE_ID"] ?? "")
  write("intervals_api_key", environment["VELOQ_API_KEY"] ?? "")
  let read = VeloqCredentials.read()
  print("  the extension's read: \(read == nil ? "nothing" : "athlete \(read!.athleteId)")")

case "clear":
  clear()
  print("  the extension's read: \(VeloqCredentials.read() == nil ? "nothing" : "a credential")")

case "seed-db":
  // An empty file, so the extension's path check finds it, opened by the
  // engine, which writes the schema. The secret never leaves this process.
  guard let url = container()?.appendingPathComponent("routes.db") else {
    print("  no App Group container")
    exit(1)
  }
  FileManager.default.createFile(atPath: url.path, contents: nil)
  let opened = VeloqPushEngine.prepare(
    databasePath: url.path,
    credentials: VeloqCredentials(accessToken: nil, apiKey: "unused", athleteId: "unused"))
  print("  engine opened at \(url.path): \(opened.ready) \(opened.refusal ?? "")")

case "drop-db":
  guard let base = container() else { exit(1) }
  for suffix in ["", "-wal", "-shm"] {
    try? FileManager.default.removeItem(at: base.appendingPathComponent("routes.db" + suffix))
  }
  print("  routes.db removed")

case "push":
  guard
    arguments.count > 1,
    let data = arguments[1].data(using: .utf8),
    let userInfo = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else {
    print("  push needs a JSON payload")
    exit(1)
  }
  let alert = (userInfo["aps"] as? [String: Any])?["alert"] as? [String: Any]
  let content = UNMutableNotificationContent()
  content.title = alert?["title"] as? String ?? ""
  content.body = alert?["body"] as? String ?? ""
  content.userInfo = userInfo
  let request = UNNotificationRequest(identifier: "harness", content: content, trigger: nil)

  let done = DispatchSemaphore(value: 0)
  var posted: UNNotificationContent?
  let service = NotificationService()
  service.didReceive(request) { answer in
    posted = answer
    done.signal()
  }
  if done.wait(timeout: .now() + 60) == .timedOut {
    service.serviceExtensionTimeWillExpire()
    _ = done.wait(timeout: .now() + 5)
    print("  timed out")
  }
  print("  posted title: \(posted?.title ?? "(nothing)")")
  print("  posted body: \(posted?.body ?? "(nothing)")")

default:
  print("  unknown mode")
  exit(2)
}
SWIFT

# The entitlements the extension ships, with the invented app id in front, as
# the XML plist and the DER twin Xcode writes for a simulator build.
/usr/bin/python3 - "$SOURCES/VeloqPushExtension.entitlements" "$TEAM.$BUNDLE" "$WORK" <<'PY'
import plistlib, sys

source, app_id, out = sys.argv[1:]
with open(source, "rb") as f:
    entitlements = plistlib.load(f)
entitlements["application-identifier"] = app_id
with open(f"{out}/entitlements.xml", "wb") as f:
    plistlib.dump(entitlements, f)

def length(n):
    if n < 0x80:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b

def tlv(tag, body):
    return bytes([tag]) + length(len(body)) + body

def value(v):
    if isinstance(v, str):
        return tlv(0x0C, v.encode())
    if isinstance(v, list):
        return tlv(0x30, b"".join(value(x) for x in v))
    raise SystemExit(f"unsupported entitlement value {v!r}")

pairs = sorted(tlv(0x30, value(k) + value(v)) for k, v in entitlements.items())
body = b"\x02\x01\x01" + tlv(0xB0, b"".join(pairs))
with open(f"{out}/entitlements.der", "wb") as f:
    f.write(bytes([0x70]) + length(len(body)) + body)
PY

APP="$WORK/Harness.app"
mkdir -p "$APP"
cat >"$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$BUNDLE</string>
<key>CFBundleExecutable</key><string>Harness</string>
<key>CFBundleName</key><string>Harness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>MinimumOSVersion</key><string>17.0</string>
</dict></plist>
PLIST

# Linked for the SDK the archive's C objects were built for, which is what
# keeps the linker quiet. The simulator runs that same release.
SDK_VERSION=$(xcrun --sdk iphonesimulator --show-sdk-version)
echo "compiling the extension's Swift into the host"
xcrun -sdk iphonesimulator swiftc -O -target "arm64-apple-ios$SDK_VERSION-simulator" \
  -module-name Harness \
  -import-objc-header "$SOURCES/VeloqPushExtension-Bridging-Header.h" \
  -L "$WORK/rust" -lveloqrs_ffi \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements -Xlinker "$WORK/entitlements.xml" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __ents_der -Xlinker "$WORK/entitlements.der" \
  "$SOURCES"/*.swift "$WORK/main.swift" -o "$APP/Harness"
codesign -f -s - "$APP" >/dev/null 2>&1
xcrun simctl install "$UDID" "$APP"

# The access group the app writes its credential under.
APP_ACCESS_GROUP=$(sed -n "s/^export const KEYCHAIN_ACCESS_GROUP = '\(.*\)';$/\1/p" \
  "$ROOT/src/shared/app/credentialKeychain.ts")
[[ -n $APP_ACCESS_GROUP ]] || { echo "error: no KEYCHAIN_ACCESS_GROUP in credentialKeychain.ts" >&2; exit 1; }

run() {
  SIMCTL_CHILD_VELOQ_API_KEY=$VELOQ_API_KEY SIMCTL_CHILD_VELOQ_ATHLETE_ID=$VELOQ_ATHLETE_ID \
    SIMCTL_CHILD_VELOQ_APP_ACCESS_GROUP=$APP_ACCESS_GROUP \
    xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE" "$@" 2>&1 |
    tr -d '\r' | grep -v "^$BUNDLE:"
}

DB="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" "$GROUP")/routes.db"

# What the app would have stored before this push: the athlete, the switch on,
# and the root locale's templates, read from the key list the app pushes.
seed_settings() {
  /usr/bin/python3 - "$DB" "$VELOQ_ATHLETE_ID" "$ROOT/src/i18n/notificationTemplates.ts" \
    "$ROOT/src/i18n/locales/en-GB.json" <<'PY'
import json, re, sqlite3, sys

db, athlete, keys_file, bundle_file = sys.argv[1:]
keys_source = open(keys_file).read()
keys = re.findall(r"'([\w.]+)'", keys_source.split("NOTIFICATION_TEMPLATE_KEYS = [", 1)[1].split("]", 1)[0])
bundle = json.load(open(bundle_file))

def resolve(key):
    value = bundle
    for part in key.split("."):
        value = value[part]
    return value

templates = {"locale": "en-GB", "templates": {k: resolve(k) for k in sorted(keys)}}
conn = sqlite3.connect(db)
for key, value in [
    ("__athlete_id", athlete),
    ("veloq-notification-preferences", json.dumps({"enabled": True})),
    ("__notification_templates", json.dumps(templates, separators=(",", ":"))),
]:
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
conn.commit()
print(f"  settings: athlete, notifications on, {len(keys)} en-GB templates")
PY
}

# The newest push_runs id, so each case prints only the rows it wrote.
last_run() {
  if [[ -f $DB ]]; then
    /usr/bin/python3 -c 'import sqlite3, sys
print(sqlite3.connect(sys.argv[1]).execute("SELECT COALESCE(MAX(id), 0) FROM push_runs").fetchone()[0])' "$DB"
  else
    echo 0
  fi
}

# The rows the Developer Dashboard would list for this case.
runs_since() {
  if [[ ! -f $DB ]]; then
    echo "  runs: no database, so nothing could be recorded"
    return
  fi
  /usr/bin/python3 - "$DB" "$1" <<'PY'
import sqlite3, sys

rows = sqlite3.connect(sys.argv[1]).execute(
    "SELECT outcome, activity_id, detail FROM push_runs WHERE id > ? ORDER BY id",
    (int(sys.argv[2]),),
).fetchall()
if not rows:
    print("  runs: none")
for outcome, activity, detail in rows:
    print(f"  run: {outcome} activity={activity or '(none)'} detail={detail or ''}")
PY
}

# The APNs payload Expo delivers for a message `buildPushMessages` writes: the
# visible title and body under `aps.alert`, `mutable-content` from
# `mutableContent`, and the message's `data` under the top-level `body` key.
payload() {
  local event=$1 activity=$2
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module - "$ROOT/oauth-proxy/src/pushMessages.ts" "$event" "$activity" \
    "$VELOQ_ATHLETE_ID" "$SERVER_TITLE" "$SERVER_BODY" <<'JS'
const [source, type, activity, athlete, title, body] = process.argv.slice(2);
const { buildPushMessages, pushDataFor } = await import(source);
const event = { type, athlete_id: athlete, activity: activity ? { id: activity } : null };
const [visible] = buildPushMessages("token", pushDataFor(event), { title, body }, "ios");
process.stdout.write(JSON.stringify({
  aps: { alert: { title: visible.title, body: visible.body }, "mutable-content": 1 },
  body: visible.data,
}));
JS
}

FAILED=0

# One push, and whether what it posted is what the case expects: `rewritten`
# or `unchanged`. A keychain query that misses the item turns the first case
# into the second, which is the failure this exists to show.
case_push() {
  local label=$1 json=$2 expected=$3 before out outcome
  echo
  echo "== $label"
  before=$(last_run)
  out=$(run push "$json")
  echo "$out"
  if grep -qxF "  posted title: $SERVER_TITLE" <<<"$out" && grep -qxF "  posted body: $SERVER_BODY" <<<"$out"; then
    outcome=unchanged
  elif grep -q "^  posted title: (nothing)" <<<"$out"; then
    outcome=nothing
  else
    outcome=rewritten
  fi
  runs_since "$before"
  if [[ $outcome == "$expected" ]]; then
    echo "  outcome: $outcome, as expected"
  else
    echo "  outcome: $outcome, expected $expected"
    FAILED=1
  fi
}

ACTIVITY_PUSH=$(payload ACTIVITY_UPLOADED "$VELOQ_ACTIVITY_ID")

echo
echo "== seed the keychain and the library"
run seed
run seed-db
seed_settings

case_push "a real activity of the seeded athlete" "$ACTIVITY_PUSH" rewritten
case_push "a wellness event" "$(payload WELLNESS_UPDATED "")" unchanged
case_push "an activity event with no activity_id" "$(payload ACTIVITY_UPLOADED "")" unchanged

echo
echo "== clear the keychain"
run clear
case_push "a real activity with no credential" "$ACTIVITY_PUSH" unchanged

echo
echo "== restore the keychain, remove the library"
run seed
run drop-db
case_push "a real activity with no routes.db" "$ACTIVITY_PUSH" unchanged

echo
if [[ $FAILED == 0 ]]; then
  echo "PASS: the extension read the credential, reached the engine and fell back where it should"
else
  echo "FAIL"
  exit 1
fi
