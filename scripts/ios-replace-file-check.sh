#!/usr/bin/env bash
# Run the replaceFile native check on the booted iOS simulator.
#
#   scripts/ios-replace-file-check.sh
#
# Runs on a Mac with Xcode and a booted simulator. It compiles
# `AtomicReplace.swift` and `ios-check/main.swift` for the simulator SDK and
# executes the result inside the simulator with `simctl spawn`, so the rename
# runs against the simulator's file system.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODULE=$ROOT/modules/veloq-backup-exclusion
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

xcrun swiftc \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios16.4-simulator \
  -o "$BUILD/replace-file-check" \
  "$MODULE/ios/AtomicReplace.swift" "$MODULE/ios-check/main.swift"

xcrun simctl spawn booted "$BUILD/replace-file-check"
