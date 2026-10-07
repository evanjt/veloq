#!/usr/bin/env bash
# Run the backup folder native check on the booted iOS simulator.
#
#   scripts/ios-folder-bookmark-check.sh
#
# Runs on a Mac with Xcode and a booted simulator. It compiles
# `FolderBookmark.swift` and `ios-folder-check/main.swift` for the simulator
# SDK and executes the result inside the simulator with `simctl spawn`, so the
# bookmarks and copies run against the simulator's file system.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODULE=$ROOT/modules/veloq-backup-exclusion
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

xcrun swiftc \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios16.4-simulator \
  -o "$BUILD/folder-bookmark-check" \
  "$MODULE/ios/FolderBookmark.swift" "$MODULE/ios-folder-check/main.swift"

xcrun simctl spawn booted "$BUILD/folder-bookmark-check"
