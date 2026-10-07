#!/usr/bin/env bash
# Replay the credential keychain upgrade on a simulator: an install that wrote
# its items with no access group, then a build that adds a keychain access
# group and moves them across. Reports what the next launch reads.
#
#   scripts/ios-keychain-group-probe.sh
#
# Runs on a Mac with Xcode. The probe is a bare app built here from Swift whose
# queries are copied from expo-secure-store's `SecureStoreModule.swift`, so it
# needs no Veloq build and no sign-in. It creates a simulator of its own and
# deletes it at the end (KEEP_SIMULATOR=1 keeps it).
#
# Old build: App Groups only, as every release before the shared group.
# New build: App Groups plus `keychain-access-groups`, as the current
# entitlements carry. The app id and group are invented for the probe.

set -euo pipefail

BUNDLE=com.example.keychainprobe
GROUP=group.com.example.keychainprobe
TEAM=ABCDE12345
WORK=$(mktemp -d)

UDID=$(xcrun simctl create "keychain-group-probe" \
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

let group = "group.com.example.keychainprobe"
let key = "intervals_api_key"

// expo-secure-store's query(with:options:requireAuthentication:), verbatim in shape.
func query(_ key: String, _ accessGroup: String?, _ auth: Bool?) -> [String: Any] {
  var service = "app"
  if let auth { service.append(":\(auth ? "auth" : "no-auth")") }
  let encoded = Data(key.utf8)
  var q: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrGeneric as String: encoded,
    kSecAttrAccount as String: encoded,
  ]
  if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
  return q
}

func search(_ key: String, _ g: String?, _ auth: Bool?) -> String? {
  var q = query(key, g, auth)
  q[kSecMatchLimit as String] = kSecMatchLimitOne
  q[kSecReturnData as String] = kCFBooleanTrue
  var item: CFTypeRef?
  let s = SecItemCopyMatching(q as CFDictionary, &item)
  if s == errSecItemNotFound { return nil }
  if s != errSecSuccess { print("    read status \(s)"); return nil }
  return (item as? Data).flatMap { String(data: $0, encoding: .utf8) }
}

// get(with:options:)
func get(_ key: String, _ g: String?) -> String? {
  search(key, g, false) ?? search(key, g, true) ?? search(key, g, nil)
}

// set(value:with:options:) for requireAuthentication false.
func set(_ key: String, _ value: String, _ g: String?, _ accessible: CFString) -> OSStatus {
  var q = query(key, g, false)
  q[kSecValueData as String] = value.data(using: .utf8)
  q[kSecAttrAccessible as String] = accessible
  let s = SecItemAdd(q as CFDictionary, nil)
  if s == errSecSuccess {
    SecItemDelete(query(key, g, nil) as CFDictionary)
    SecItemDelete(query(key, g, true) as CFDictionary)
    return s
  }
  if s == errSecDuplicateItem {
    let u = [kSecValueData as String: value.data(using: .utf8)!]
    return SecItemUpdate(query(key, g, false) as CFDictionary, u as CFDictionary)
  }
  return s
}

// deleteValueWithKeyAsync
func remove(_ key: String, _ g: String?) {
  SecItemDelete(query(key, g, nil) as CFDictionary)
  SecItemDelete(query(key, g, true) as CFDictionary)
  SecItemDelete(query(key, g, false) as CFDictionary)
}

func dump() {
  let q: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecMatchLimit as String: kSecMatchLimitAll,
    kSecReturnAttributes as String: kCFBooleanTrue!,
  ]
  var items: CFTypeRef?
  let s = SecItemCopyMatching(q as CFDictionary, &items)
  guard s == errSecSuccess, let list = items as? [[String: Any]] else {
    print("    items: none (\(s))")
    return
  }
  for a in list {
    let svc = a[kSecAttrService as String] as? String ?? "?"
    let agrp = a[kSecAttrAccessGroup as String] as? String ?? "?"
    let pdmn = a[kSecAttrAccessible as String] as? String ?? "?"
    print("    item service=\(svc) group=\(agrp) accessible=\(pdmn)")
  }
}

// readCredentialsWithMigration for one key, with the remove step optional.
func migrate(removeLegacy: Bool) {
  if let v = get(key, group) { print("    new read: \(v), nothing to move"); return }
  guard let legacy = get(key, nil) else { print("    signed out: nothing under either"); return }
  print("    legacy read: \(legacy)")
  print("    write new: status \(set(key, legacy, group, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly))")
  if removeLegacy { remove(key, nil); print("    removed legacy (no access group)") }
}

let mode = CommandLine.arguments.dropFirst().first ?? "dump"
print("mode \(mode)")
switch mode {
case "sign-in":
  print("    write legacy: status \(set(key, "secret", nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly))")
case "migrate": migrate(removeLegacy: true)
case "migrate-keep": migrate(removeLegacy: false)
case "launch":
  print("    new read: \(get(key, group) ?? "null"), legacy read: \(get(key, nil) ?? "null")")
case "sign-out": remove(key, nil); print("    removed with no access group")
case "group-write":
  print("    write new: status \(set(key, "fresh", group, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly))")
default: break
}
dump()
SWIFT

build() {
  local name=$1 ent=$2 app="$WORK/$1/Probe.app"
  mkdir -p "$app"
  cat >"$app/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$BUNDLE</string>
<key>CFBundleExecutable</key><string>Probe</string>
<key>CFBundleName</key><string>Probe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSRequiresIPhoneOS</key><true/>
<key>MinimumOSVersion</key><string>17.0</string>
</dict></plist>
PLIST
  printf '%s' "$ent" >"$WORK/$name.entitlements"
  xcrun -sdk iphonesimulator swiftc -O -target arm64-apple-ios17.0-simulator \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements \
    -Xlinker "$WORK/$name.entitlements" \
    "$WORK/main.swift" -o "$app/Probe"
  codesign -f -s - "$app" >/dev/null 2>&1
  echo "$app"
}

ent() {
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo "<plist version=\"1.0\"><dict>"
  echo "<key>application-identifier</key><string>$TEAM.$BUNDLE</string>"
  echo "<key>com.apple.security.application-groups</key><array><string>$GROUP</string></array>"
  [[ ${1:-} == keychain ]] &&
    echo "<key>keychain-access-groups</key><array><string>$GROUP</string></array>"
  echo "</dict></plist>"
}

OLD=$(build old "$(ent)")
NEW=$(build new "$(ent keychain)")

run() { xcrun simctl launch --console-pty "$UDID" "$BUNDLE" "$1" 2>&1 | tr -d '\r' | grep -v "^$BUNDLE:"; }

scenario() {
  local label=$1 step=$2
  echo
  echo "== $label"
  xcrun simctl install "$UDID" "$OLD"
  run sign-out >/dev/null
  run sign-in
  xcrun simctl install "$UDID" "$NEW"
  echo "-- first launch of the new build"
  run "$step"
  echo "-- second launch"
  run launch
  echo "-- sign out, then launch"
  run sign-out
  run launch
}

scenario "migrate, removing the legacy copy with no access group (as shipped)" migrate
scenario "migrate, keeping the legacy copy" migrate-keep

echo
echo "== the shared group with App Groups only, no keychain-access-groups"
xcrun simctl install "$UDID" "$OLD"
run sign-out >/dev/null
run group-write
run launch
