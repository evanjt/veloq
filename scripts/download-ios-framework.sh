#!/bin/bash
# Downloads the pre-built iOS XCFramework for local development
# This is required before running `npx expo run:ios`

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get version from package.json
TRACEMATCH_VERSION=$(node -p "require('$PROJECT_ROOT/package.json').tracematchVersion")
if [ -z "$TRACEMATCH_VERSION" ]; then
    echo "Error: Could not read tracematchVersion from package.json"
    exit 1
fi

echo "Downloading tracematch iOS framework v${TRACEMATCH_VERSION}..."

RELEASE_URL="https://github.com/evanjt/route-matcher/releases/download/${TRACEMATCH_VERSION}"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Download iOS release
echo "Fetching from ${RELEASE_URL}/tracematch-ios-${TRACEMATCH_VERSION}.zip"
curl -sL "${RELEASE_URL}/tracematch-ios-${TRACEMATCH_VERSION}.zip" -o "$TEMP_DIR/ios.zip"

if [ ! -f "$TEMP_DIR/ios.zip" ] || [ ! -s "$TEMP_DIR/ios.zip" ]; then
    echo "Error: Failed to download iOS framework"
    exit 1
fi

# Extract
unzip -q "$TEMP_DIR/ios.zip" -d "$TEMP_DIR/tracematch"

# Install XCFramework (rename to match podspec expectation)
FRAMEWORKS_DIR="$PROJECT_ROOT/modules/route-matcher-native/ios/Frameworks"
mkdir -p "$FRAMEWORKS_DIR"
rm -rf "$FRAMEWORKS_DIR/TracematchFFI.xcframework"
cp -r "$TEMP_DIR/tracematch/ios/RouteMatcherFFI.xcframework" \
      "$FRAMEWORKS_DIR/TracematchFFI.xcframework"
echo "✓ Installed XCFramework to $FRAMEWORKS_DIR"

# Install Swift bindings
GENERATED_DIR="$PROJECT_ROOT/modules/route-matcher-native/ios/Generated"
mkdir -p "$GENERATED_DIR"
cp "$TEMP_DIR/tracematch/ios/Generated/tracematch.swift" "$GENERATED_DIR/"
cp "$TEMP_DIR/tracematch/ios/Generated/tracematchFFI.h" "$GENERATED_DIR/"
cp "$TEMP_DIR/tracematch/ios/Generated/tracematchFFI.modulemap" "$GENERATED_DIR/"
echo "✓ Installed Swift bindings to $GENERATED_DIR"

# Verify installation
echo ""
echo "Installed files:"
ls -la "$FRAMEWORKS_DIR/"
ls -la "$GENERATED_DIR/"

echo ""
echo "iOS framework setup complete!"
echo ""
echo "Next steps:"
echo "  1. npx expo prebuild --platform ios --clean"
echo "  2. cd ios && pod install && cd .."
echo "  3. npx expo run:ios"
