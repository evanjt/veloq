#!/usr/bin/env bash
# capture-hierarchy.sh — Capture UI hierarchy snapshots for visual regression diffing.
#
# Navigates to each screen via Maestro deep links, captures the element tree,
# and saves it to .maestro/snapshots/. Committed snapshots can be git-diffed
# to detect structural regressions (missing elements, changed text, moved testIDs).
#
# Usage:
#   ./scripts/capture-hierarchy.sh [android|ios]
#
# Prerequisites:
#   - App running in demo mode on a connected device/simulator
#   - Maestro installed and on PATH
#   - For iOS: simulator booted. For Android: device/emulator connected via adb.

set -euo pipefail

PLATFORM="${1:-android}"
SNAPSHOT_DIR=".maestro/snapshots"
SCHEME="veloq"
WAIT_SECS=4  # seconds to wait for screen to settle after navigation

# Validate maestro is available
if ! command -v maestro &>/dev/null; then
  echo "Error: maestro not found on PATH"
  echo "Install: curl -Ls 'https://get.maestro.mobile.dev' | bash"
  exit 1
fi

mkdir -p "$SNAPSHOT_DIR"

# Navigate to a screen via deep link
navigate() {
  local route="$1"
  local url="${SCHEME}://${route}"

  if [ "$PLATFORM" = "ios" ]; then
    # Get booted simulator UDID
    local udid
    udid=$(xcrun simctl list devices booted -j | python3 -c "
import sys, json
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('state') == 'Booted':
            print(d['udid'])
            sys.exit(0)
" 2>/dev/null || true)
    if [ -z "$udid" ]; then
      echo "Error: No booted iOS simulator found"
      exit 1
    fi
    xcrun simctl openurl "$udid" "$url"
  else
    adb shell am start -a android.intent.action.VIEW -d "$url" com.veloq.app 2>/dev/null
  fi
}

# Capture hierarchy for a named screen
capture() {
  local name="$1"
  local route="$2"
  local output_file="${SNAPSHOT_DIR}/${name}.json"

  echo -n "  Capturing ${name}..."
  navigate "$route"
  sleep "$WAIT_SECS"

  # Capture hierarchy and normalize to JSON
  maestro hierarchy 2>/dev/null | python3 -c "
import sys, json

raw = sys.stdin.read().strip()

# Try parsing as JSON first (iOS format / compact mode)
try:
    tree = json.loads(raw)
    json.dump(tree, sys.stdout, indent=2, sort_keys=True)
    sys.exit(0)
except json.JSONDecodeError:
    pass

# If not JSON, it's XML (Android). Convert to a simplified JSON structure.
import xml.etree.ElementTree as ET

def xml_to_dict(elem):
    node = {}
    # Keep useful attributes, skip empty ones
    for key in ['text', 'resource-id', 'content-desc', 'class', 'clickable', 'enabled', 'bounds']:
        val = elem.get(key, '')
        if val:
            node[key] = val
    children = [xml_to_dict(child) for child in elem]
    if children:
        node['children'] = children
    return node

try:
    root = ET.fromstring(raw)
    tree = xml_to_dict(root)
    json.dump(tree, sys.stdout, indent=2, sort_keys=True)
except ET.ParseError:
    # Last resort: save raw
    sys.stdout.write(raw)
" > "$output_file" 2>/dev/null

  local size
  size=$(wc -c < "$output_file" | tr -d ' ')
  echo " done (${size} bytes)"
}

echo "=== Veloq UI Hierarchy Snapshot ==="
echo "Platform: ${PLATFORM}"
echo "Output:   ${SNAPSHOT_DIR}/"
echo ""

# Capture hierarchy for each screen
echo "Tab screens:"
capture "home"           ""
capture "fitness"        "fitness"
capture "training"       "training"
capture "map"            "map"
capture "routes"         "routes"

echo ""
echo "Detail screens:"
capture "activity-detail" "activity/demo-test-0"
capture "settings"        "settings"

echo ""
echo "Done! Snapshots saved to ${SNAPSHOT_DIR}/"
echo ""
echo "To diff against previous run:"
echo "  git diff ${SNAPSHOT_DIR}/"
echo ""
echo "To see what changed on a specific screen:"
echo "  git diff ${SNAPSHOT_DIR}/fitness.json"
