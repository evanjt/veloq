#!/bin/bash
set -e

# Fast Android build for DEVELOPMENT - only builds arm64 + x86_64
# Use this for quick iteration. Full build uses build-android.sh
#
# Usage:
#   ./build-android-dev.sh          # Build both arm64 (device) and x86_64 (emulator)
#   ./build-android-dev.sh arm64    # Build only arm64 for physical devices
#   ./build-android-dev.sh x86_64   # Build only x86_64 for emulators

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_DIR}/target/android"
MODULE_DIR="${PROJECT_DIR}/../../modules/route-matcher-native/android/src/main"

cd "$PROJECT_DIR"

# Check for cargo-ndk
if ! command -v cargo-ndk &> /dev/null; then
    echo "cargo-ndk not found. Installing..."
    cargo install cargo-ndk
fi

# Determine which architectures to build
ARCH=${1:-"both"}

build_arm64() {
    echo "🦀 Building for arm64-v8a (physical devices)..."
    cargo ndk -t arm64-v8a build --release --features full
    mkdir -p "$OUTPUT_DIR/jniLibs/arm64-v8a"
    cp target/aarch64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/arm64-v8a/"
}

build_x86_64() {
    echo "🦀 Building for x86_64 (emulators)..."
    cargo ndk -t x86_64 build --release --features full
    mkdir -p "$OUTPUT_DIR/jniLibs/x86_64"
    cp target/x86_64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86_64/"
}

case "$ARCH" in
    arm64|arm64-v8a|device)
        build_arm64
        ;;
    x86_64|x86-64|emulator|emu)
        build_x86_64
        ;;
    both|all|"")
        build_arm64
        build_x86_64
        ;;
    *)
        echo "Unknown architecture: $ARCH"
        echo "Usage: $0 [arm64|x86_64|both]"
        exit 1
        ;;
esac

# Install to native module
echo "📦 Installing to native module..."
mkdir -p "$MODULE_DIR/jniLibs/arm64-v8a"
mkdir -p "$MODULE_DIR/jniLibs/x86_64"

[ -f "$OUTPUT_DIR/jniLibs/arm64-v8a/libroute_matcher.so" ] && \
    cp -v "$OUTPUT_DIR/jniLibs/arm64-v8a/libroute_matcher.so" "$MODULE_DIR/jniLibs/arm64-v8a/"
[ -f "$OUTPUT_DIR/jniLibs/x86_64/libroute_matcher.so" ] && \
    cp -v "$OUTPUT_DIR/jniLibs/x86_64/libroute_matcher.so" "$MODULE_DIR/jniLibs/x86_64/"

echo "✅ Dev build complete!"
