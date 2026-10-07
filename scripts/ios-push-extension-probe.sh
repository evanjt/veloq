#!/usr/bin/env bash
# Ask whether `simctl push` runs a notification service extension, and whether
# registering for remote notifications is what decides it.
#
#   scripts/ios-push-extension-probe.sh
#
# Runs on a Mac with Xcode. The probe is a bare app and extension built here
# from Swift, carrying `aps-environment` the way an Xcode simulator build does:
# the XML plist in `__TEXT,__entitlements` and its DER twin in
# `__TEXT,__ents_der`. It needs no Veloq build and no sign-in. It creates a
# simulator of its own and deletes it at the end (KEEP_SIMULATOR=1 keeps it).
#
# Each case installs fresh, launches once, terminates, pushes a
# mutable-content payload, then reads the log for the extension's line.

set -euo pipefail

BUNDLE=com.example.pushprobe
TEAM=ABCDE12345
WORK=$(mktemp -d)

UDID=$(xcrun simctl create "push-extension-probe" \
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

cat >"$WORK/app.swift" <<'SWIFT'
import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ app: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    window?.rootViewController = UIViewController()
    window?.makeKeyAndVisible()
    let register = ProcessInfo.processInfo.arguments.contains("register")
    // Provisional authorisation is granted without a prompt, so nothing waits on a tap.
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .provisional]) {
      granted, error in
      NSLog("PUSHPROBE authorised \(granted) \(String(describing: error))")
      if register { DispatchQueue.main.async { app.registerForRemoteNotifications() } }
    }
    return true
  }

  func application(_ app: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
    NSLog("PUSHPROBE registered \(token.count) byte token")
  }

  func application(_ app: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NSLog("PUSHPROBE registration failed \(error.localizedDescription)")
  }
}
SWIFT

cat >"$WORK/service.swift" <<'SWIFT'
import Foundation
import UserNotifications

@objc(NotificationService)
class NotificationService: UNNotificationServiceExtension {
  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler handler: @escaping (UNNotificationContent) -> Void
  ) {
    NSLog("PUSHPROBE extension ran for \(request.identifier)")
    let content = request.content.mutableCopy() as! UNMutableNotificationContent
    content.title = "rewritten by the extension"
    handler(content)
  }
}
SWIFT

# The DER form of a flat entitlements dict of strings and string arrays, as
# Xcode writes it beside the XML for a simulator build.
der() {
  python3 - "$@" <<'PY'
import sys

def length(n):
    if n < 0x80:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b

def tlv(tag, body):
    return bytes([tag]) + length(len(body)) + body

def utf8(s):
    return tlv(0x0C, s.encode())

out, args = sys.argv[1], sys.argv[2:]
pairs = []
for a in args:
    key, value = a.split("=", 1)
    v = tlv(0x30, b"".join(utf8(x) for x in value[1:].split(","))) if value.startswith("@") else utf8(value)
    pairs.append((key, tlv(0x30, utf8(key) + v)))
body = b"".join(p for _, p in sorted(pairs))
blob = bytes([0x70]) + length(len(b"\x02\x01\x01" + tlv(0xB0, body)) ) + b"\x02\x01\x01" + tlv(0xB0, body)
open(out, "wb").write(blob)
PY
}

plist() {
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  for a in "$@"; do echo "<key>${a%%=*}</key><string>${a#*=}</string>"; done
  echo '</dict></plist>'
}

# Entitlements go into both sections, then the bundle is signed ad hoc as Xcode does.
sections() {
  local name=$1
  shift
  plist "$@" >"$WORK/$name.xml"
  der "$WORK/$name.der" "$@"
  echo -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements -Xlinker "$WORK/$name.xml" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __ents_der -Xlinker "$WORK/$name.der"
}

build() {
  local tag=$1 aps=$2 id="$BUNDLE.$1"
  local app="$WORK/$tag/Probe.app" appex="$WORK/$tag/Probe.app/PlugIns/Service.appex"
  mkdir -p "$appex"
  cat >"$app/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$id</string>
<key>CFBundleExecutable</key><string>Probe</string>
<key>CFBundleName</key><string>Probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>MinimumOSVersion</key><string>17.0</string>
<key>UILaunchScreen</key><dict/>
</dict></plist>
PLIST
  cat >"$appex/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$id.Service</string>
<key>CFBundleExecutable</key><string>Service</string>
<key>CFBundleName</key><string>Service</string>
<key>CFBundlePackageType</key><string>XPC!</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>MinimumOSVersion</key><string>17.0</string>
<key>NSExtension</key><dict>
<key>NSExtensionPointIdentifier</key><string>com.apple.usernotifications.service</string>
<key>NSExtensionPrincipalClass</key><string>NotificationService</string>
</dict>
</dict></plist>
PLIST
  local app_ent=("application-identifier=$TEAM.$id")
  [[ $aps == aps ]] && app_ent+=("aps-environment=development")
  # shellcheck disable=SC2046
  xcrun -sdk iphonesimulator swiftc -O -target arm64-apple-ios17.0-simulator -parse-as-library \
    $(sections "$tag-app" "${app_ent[@]}") "$WORK/app.swift" -o "$app/Probe"
  # shellcheck disable=SC2046
  xcrun -sdk iphonesimulator swiftc -O -target arm64-apple-ios17.0-simulator -parse-as-library \
    -application-extension -module-name Service \
    -Xlinker -e -Xlinker _NSExtensionMain \
    $(sections "$tag-ext" "application-identifier=$TEAM.$id.Service") \
    "$WORK/service.swift" -o "$appex/Service"
  codesign -f -s - "$appex" >/dev/null 2>&1
  codesign -f -s - "$app" >/dev/null 2>&1
}

cat >"$WORK/payload.json" <<'JSON'
{"aps": {"alert": {"title": "original title", "body": "probe"}, "mutable-content": 1}}
JSON

since() { date '+%Y-%m-%d %H:%M:%S'; }

probe() {
  local label=$1 tag=$2 aps=$3 arg=$4 id="$BUNDLE.$2" t
  echo
  echo "== $label"
  build "$tag" "$aps"
  t=$(since)
  if ! xcrun simctl install "$UDID" "$WORK/$tag/Probe.app"; then echo "   install refused"; return; fi
  echo "   pluginkit: $(xcrun simctl spawn "$UDID" pluginkit -m -i "$id.Service" 2>&1 | tr -s ' \t' ' ')"
  if ! xcrun simctl launch "$UDID" "$id" "$arg" >/dev/null; then echo "   launch refused"; return; fi
  sleep 5
  xcrun simctl terminate "$UDID" "$id" >/dev/null 2>&1 || true
  sleep 1
  xcrun simctl push "$UDID" "$id" "$WORK/payload.json"
  sleep 8
  xcrun simctl spawn "$UDID" log show --start "$t" --style compact --info --debug \
    --predicate 'process != "log" AND (eventMessage CONTAINS "PUSHPROBE" OR process == "Service"
      OR (process == "usernotificationsd" AND eventMessage CONTAINS[c] "'"$id"'")
      OR (process == "SpringBoard" AND eventMessage CONTAINS[c] "'"$id"'" AND eventMessage CONTAINS[c] "notification"))' \
    2>/dev/null | grep -E '^[0-9]{4}-' |
    grep -E 'PUSHPROBE|Forwarding addRequest|Adding notification request|Service\[|[Ee]xtension|Saving notification .*completed' |
    sed 's/^/   /' | cut -c1-220
  echo "   extension lines: $(xcrun simctl spawn "$UDID" log show --start "$t" --style compact \
    --predicate 'process != "log" AND eventMessage CONTAINS "PUSHPROBE extension ran"' 2>/dev/null |
    grep -cE '^[0-9]{4}-' || true)"
}

probe "aps-environment, authorised, never registered" unreg aps auth
probe "aps-environment, authorised and registered" reg aps register
probe "no aps-environment, authorised, registration attempted" noaps none register
