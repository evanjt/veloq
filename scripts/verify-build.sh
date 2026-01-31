#!/bin/bash
# Verify veloqrs build outputs exist and are valid
#
# Usage:
#   ./scripts/verify-build.sh android [arch]    # Verify Android build
#   ./scripts/verify-build.sh ios [target]      # Verify iOS build
#   ./scripts/verify-build.sh bindings          # Verify committed bindings
#   ./scripts/verify-build.sh all               # Verify everything
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

set -euo pipefail

cd "$(dirname "$0")/.."

MODULE_DIR="modules/veloqrs"
ERRORS=0

check_file() {
  if [[ -f "$1" ]]; then
    echo "  ✓ $1"
  else
    echo "  ✗ $1 (missing)"
    ERRORS=$((ERRORS + 1))
  fi
}

check_dir() {
  if [[ -d "$1" ]]; then
    echo "  ✓ $1/"
  else
    echo "  ✗ $1/ (missing)"
    ERRORS=$((ERRORS + 1))
  fi
}

verify_bindings() {
  echo "=== Verifying committed bindings ==="

  # TypeScript bindings
  check_file "$MODULE_DIR/src/generated/veloqrs.ts"
  check_file "$MODULE_DIR/src/generated/veloqrs-ffi.ts"

  # C++ bindings
  check_file "$MODULE_DIR/cpp/generated/veloqrs.cpp"
  check_file "$MODULE_DIR/cpp/generated/veloqrs.hpp"

  # Turbo-module wrappers
  check_file "$MODULE_DIR/cpp/veloqrs.h"
  check_file "$MODULE_DIR/cpp/veloqrs.cpp"
}

verify_android() {
  local ARCH="${1:-arm64-v8a}"
  echo "=== Verifying Android build ($ARCH) ==="

  check_file "$MODULE_DIR/android/src/main/jniLibs/$ARCH/libveloqrs.so"

  # Check library exports
  if [[ -f "$MODULE_DIR/android/src/main/jniLibs/$ARCH/libveloqrs.so" ]]; then
    if command -v nm &> /dev/null; then
      local SYMBOLS=$(nm -D "$MODULE_DIR/android/src/main/jniLibs/$ARCH/libveloqrs.so" 2>/dev/null | grep -c "uniffi_" || true)
      if [[ "$SYMBOLS" -gt 0 ]]; then
        echo "  ✓ Library exports $SYMBOLS UniFFI symbols"
      else
        echo "  ✗ Library missing UniFFI symbols"
        ERRORS=$((ERRORS + 1))
      fi
    fi
  fi
}

verify_ios() {
  local TARGET="${1:-simulator}"
  echo "=== Verifying iOS build ($TARGET) ==="

  case "$TARGET" in
    simulator)
      check_dir "$MODULE_DIR/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64_x86_64-simulator"
      check_file "$MODULE_DIR/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64_x86_64-simulator/libveloqrs_ffi.a"
      ;;
    device)
      check_dir "$MODULE_DIR/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64"
      check_file "$MODULE_DIR/ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64/libveloqrs_ffi.a"
      ;;
    all)
      check_file "$MODULE_DIR/ios/Frameworks/VeloqrsFFI.xcframework/Info.plist"
      verify_ios simulator
      verify_ios device
      ;;
  esac
}

case "${1:-all}" in
  bindings)
    verify_bindings
    ;;
  android)
    verify_android "${2:-arm64-v8a}"
    ;;
  ios)
    verify_ios "${2:-simulator}"
    ;;
  all)
    verify_bindings
    echo ""
    # Only verify platform builds if they exist (they're gitignored)
    if [[ -d "$MODULE_DIR/android/src/main/jniLibs" ]]; then
      verify_android
    else
      echo "=== Android build not present (gitignored) ==="
    fi
    echo ""
    if [[ -d "$MODULE_DIR/ios/Frameworks" ]]; then
      verify_ios all
    else
      echo "=== iOS build not present (gitignored) ==="
    fi
    ;;
  *)
    echo "Usage: $0 <bindings|android|ios|all> [target]"
    exit 1
    ;;
esac

echo ""
if [[ $ERRORS -eq 0 ]]; then
  echo "=== All checks passed ==="
  exit 0
else
  echo "=== $ERRORS check(s) failed ==="
  exit 1
fi
