#!/bin/bash
# Clean build artifacts for rebuild
# Usage: ./scripts/clean.sh          (preserves rust/target/ and bindings for fast incremental rebuilds)
#        ./scripts/clean.sh --full   (removes everything including rust/target/ and generated bindings)
#        npm run clean (from modules/veloqrs)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"

FULL=false
if [ "$1" = "--full" ]; then
  FULL=true
fi

echo "🧹 Cleaning veloqrs build artifacts..."

# Rust build cache (only with --full flag)
if [ "$FULL" = true ] && [ -d "$MODULE_DIR/rust/target" ]; then
  echo "  Removing rust/target/"
  rm -rf "$MODULE_DIR/rust/target"
fi

# Android jniLibs (copied .so files)
if [ -d "$MODULE_DIR/android/src/main/jniLibs" ]; then
  echo "  Removing android/src/main/jniLibs/"
  rm -rf "$MODULE_DIR/android/src/main/jniLibs"
fi

# Android Gradle build output
if [ -d "$MODULE_DIR/android/build" ]; then
  echo "  Removing android/build/"
  rm -rf "$MODULE_DIR/android/build"
fi

# Android CMake build cache
if [ -d "$MODULE_DIR/android/.cxx" ]; then
  echo "  Removing android/.cxx/"
  rm -rf "$MODULE_DIR/android/.cxx"
fi

# Generated bindings (only with --full flag — Expo plugin detects staleness automatically)
if [ "$FULL" = true ]; then
  if [ -d "$MODULE_DIR/src/generated" ]; then
    echo "  Removing src/generated/"
    rm -rf "$MODULE_DIR/src/generated"
  fi

  if [ -d "$MODULE_DIR/android/generated" ]; then
    echo "  Removing android/generated/"
    rm -rf "$MODULE_DIR/android/generated"
  fi

  if [ -d "$MODULE_DIR/cpp/generated" ]; then
    echo "  Removing cpp/generated/"
    rm -rf "$MODULE_DIR/cpp/generated"
  fi
fi

# iOS build artifacts
if [ -d "$MODULE_DIR/ios/Frameworks" ]; then
  echo "  Removing ios/Frameworks/"
  rm -rf "$MODULE_DIR/ios/Frameworks"
fi

if [ -d "$MODULE_DIR/ios/cpp" ]; then
  echo "  Removing ios/cpp/"
  rm -rf "$MODULE_DIR/ios/cpp"
fi

if [ -d "$MODULE_DIR/ios/build" ]; then
  echo "  Removing ios/build/"
  rm -rf "$MODULE_DIR/ios/build"
fi

if [ "$FULL" = true ]; then
  echo "✅ Full clean complete (including Rust compilation cache). Rebuild will recompile from scratch."
else
  echo "✅ Clean complete (Rust compilation cache preserved). Rebuild will use incremental compilation (~30s)."
fi
