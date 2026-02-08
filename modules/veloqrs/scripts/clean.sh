#!/bin/bash
# Clean all build artifacts to force a full rebuild
# Usage: ./scripts/clean.sh
#        npm run clean (from modules/veloqrs)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODULE_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 Cleaning veloqrs build artifacts..."

# Rust build cache (the actual .so files)
if [ -d "$MODULE_DIR/rust/target" ]; then
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

# Generated TypeScript bindings
if [ -d "$MODULE_DIR/src/generated" ]; then
  echo "  Removing src/generated/"
  rm -rf "$MODULE_DIR/src/generated"
fi

# Generated Kotlin/Java bindings
if [ -d "$MODULE_DIR/android/generated" ]; then
  echo "  Removing android/generated/"
  rm -rf "$MODULE_DIR/android/generated"
fi

# Generated C++ bindings
if [ -d "$MODULE_DIR/cpp/generated" ]; then
  echo "  Removing cpp/generated/"
  rm -rf "$MODULE_DIR/cpp/generated"
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

echo "✅ Clean complete. Run 'npx expo run:android' or 'npx expo run:ios' to rebuild everything (bindings + binaries)."
