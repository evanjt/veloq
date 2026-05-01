#!/bin/bash
# Sets up StoreKit Configuration for local IAP testing on iOS simulator.
#
# Run after `npx expo run:ios` generates the ios/ directory:
#   bash scripts/setup-storekit.sh
#
# This copies the StoreKit config into the Xcode project and patches the
# scheme so Debug builds inject fake IAP products automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_SRC="$ROOT_DIR/config/StoreKitConfiguration.storekit"
APP_DIR="$ROOT_DIR/ios/VeloqDev"
SCHEME="$ROOT_DIR/ios/VeloqDev.xcodeproj/xcshareddata/xcschemes/VeloqDev.xcscheme"

if [ ! -d "$APP_DIR" ]; then
  echo "Error: ios/VeloqDev/ not found. Run 'npx expo run:ios' first."
  exit 1
fi

if [ ! -f "$CONFIG_SRC" ]; then
  echo "Error: config/StoreKitConfiguration.storekit not found."
  exit 1
fi

# 1. Copy StoreKit config into the app directory
cp "$CONFIG_SRC" "$APP_DIR/StoreKitConfiguration.storekit"
echo "Copied StoreKit config to $APP_DIR/"

# 2. Patch the Xcode scheme to reference it (if not already)
if [ -f "$SCHEME" ]; then
  if grep -q "StoreKitConfigurationFileReference" "$SCHEME"; then
    echo "Scheme already references StoreKit config."
  else
    # Insert StoreKitConfigurationFileReference inside <LaunchAction>
    sed -i '' '/<LaunchAction/,/<\/LaunchAction>/{
      /<\/LaunchAction>/i\
      <StoreKitConfigurationFileReference\
         identifier = "../VeloqDev/StoreKitConfiguration.storekit">\
      </StoreKitConfigurationFileReference>
    }' "$SCHEME"
    echo "Patched scheme to use StoreKit config."
  fi
else
  echo "Warning: Scheme not found at $SCHEME — set StoreKit config manually in Xcode."
fi

echo "Done. Build with Debug configuration to test IAP on the simulator."
