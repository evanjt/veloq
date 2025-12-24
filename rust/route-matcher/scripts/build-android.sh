#!/bin/bash
set -e

# Build route-matcher for Android
# Prerequisites:
#   - Rust with Android targets:
#     rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
#   - Android NDK
#   - cargo-ndk: cargo install cargo-ndk

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_DIR}/target/android"

echo "Building route-matcher for Android..."
cd "$PROJECT_DIR"

# Check for cargo-ndk
if ! command -v cargo-ndk &> /dev/null; then
    echo "cargo-ndk not found. Installing..."
    cargo install cargo-ndk
fi

# Build for all Android architectures
echo "Building for all Android architectures..."

# arm64-v8a (most modern Android devices)
echo "Building for aarch64-linux-android (arm64-v8a)..."
cargo ndk -t arm64-v8a build --release --features ffi,parallel

# armeabi-v7a (older 32-bit devices)
echo "Building for armv7-linux-androideabi (armeabi-v7a)..."
cargo ndk -t armeabi-v7a build --release --features ffi,parallel

# x86_64 (emulator on Intel/AMD)
echo "Building for x86_64-linux-android (x86_64)..."
cargo ndk -t x86_64 build --release --features ffi,parallel

# x86 (older emulators)
echo "Building for i686-linux-android (x86)..."
cargo ndk -t x86 build --release --features ffi,parallel

# Create output directory structure (matches Android's jniLibs)
mkdir -p "$OUTPUT_DIR/jniLibs/arm64-v8a"
mkdir -p "$OUTPUT_DIR/jniLibs/armeabi-v7a"
mkdir -p "$OUTPUT_DIR/jniLibs/x86_64"
mkdir -p "$OUTPUT_DIR/jniLibs/x86"

# Copy libraries
echo "Copying libraries..."
cp target/aarch64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/arm64-v8a/"
cp target/armv7-linux-androideabi/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/armeabi-v7a/"
cp target/x86_64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86_64/"
cp target/i686-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86/"

# Generate Kotlin bindings
echo "Generating Kotlin bindings..."
mkdir -p "$OUTPUT_DIR/kotlin"
cargo run --features ffi --bin uniffi-bindgen generate \
    --library target/aarch64-linux-android/release/libroute_matcher.so \
    --language kotlin \
    --out-dir "$OUTPUT_DIR/kotlin" 2>/dev/null || {
    # Fallback: use uniffi-bindgen-cli if available
    echo "Using uniffi-bindgen CLI..."
    uniffi-bindgen generate \
        --library target/aarch64-linux-android/release/libroute_matcher.so \
        --language kotlin \
        --out-dir "$OUTPUT_DIR/kotlin" 2>/dev/null || {
        echo "Note: Kotlin bindings generation skipped (uniffi-bindgen not available)"
        echo "Install with: cargo install uniffi_bindgen"
    }
}

echo ""
echo "Build complete!"
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "jniLibs structure:"
find "$OUTPUT_DIR/jniLibs" -type f 2>/dev/null || true
echo ""
echo "To use in Android:"
echo "  1. Copy jniLibs/* to android/app/src/main/jniLibs/"
echo "  2. Copy kotlin/* to your Kotlin source directory"
