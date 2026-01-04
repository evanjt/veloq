#!/bin/bash
set -e

# Build route-matcher for Android (PARALLEL - ALWAYS)
# Builds all architectures in parallel for 2-3x faster builds
# Build once, use for both preview and release deployments

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_DIR}/target/android"

cd "$PROJECT_DIR"

# Check if libraries are already built (from cache)
LIBS_EXIST=1
[ -f "target/aarch64-linux-android/release/libroute_matcher.so" ] || LIBS_EXIST=0
[ -f "target/armv7-linux-androideabi/release/libroute_matcher.so" ] || LIBS_EXIST=0
[ -f "target/x86_64-linux-android/release/libroute_matcher.so" ] || LIBS_EXIST=0
[ -f "target/i686-linux-android/release/libroute_matcher.so" ] || LIBS_EXIST=0

if [ "$LIBS_EXIST" -eq 1 ]; then
  echo "✅ Rust libraries already built (from cache), skipping build"
  mkdir -p "$OUTPUT_DIR/jniLibs"/{arm64-v8a,armeabi-v7a,x86_64,x86}
  cp target/aarch64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/arm64-v8a/"
  cp target/armv7-linux-androideabi/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/armeabi-v7a/"
  cp target/x86_64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86_64/"
  cp target/i686-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86/"
  exit 0
fi

echo "🚀 Building route-matcher for Android (ALL architectures in parallel)..."

# Check for cargo-ndk
if ! command -v cargo-ndk &> /dev/null; then
  echo "cargo-ndk not found. Installing..."
  cargo install cargo-ndk
fi

# Create output directory structure
mkdir -p "$OUTPUT_DIR/jniLibs"/{arm64-v8a,armeabi-v7a,x86_64,x86}

# Build all architectures in parallel using background jobs
PIDS=()

echo "🔨 Building all Android architectures in parallel..."

# arm64-v8a (most modern Android devices)
echo "  → arm64-v8a (physical devices)"
cargo ndk -t arm64-v8a build --release --features full &
PIDS+=($!)

# armeabi-v7a (older 32-bit devices)
echo "  → armeabi-v7a (legacy 32-bit devices)"
cargo ndk -t armeabi-v7a build --release --features full &
PIDS+=($!)

# x86_64 (emulator on Intel/AMD)
echo "  → x86_64 (emulator)"
cargo ndk -t x86_64 build --release --features full &
PIDS+=($!)

# x86 (older emulators)
echo "  → x86 (legacy emulator)"
cargo ndk -t x86 build --release --features full &
PIDS+=($!)

# Wait for all builds to complete
echo "⏳ Waiting for all builds to complete..."
for pid in "${PIDS[@]}"; do
  wait "$pid" || {
    echo "❌ Build failed for pid $pid"
    exit 1
  }
done

echo "✅ All architectures built successfully!"

# Copy libraries
echo "📦 Copying libraries..."
cp target/aarch64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/arm64-v8a/"
cp target/armv7-linux-androideabi/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/armeabi-v7a/"
cp target/x86_64-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86_64/"
cp target/i686-linux-android/release/libroute_matcher.so "$OUTPUT_DIR/jniLibs/x86/"

# Generate Kotlin bindings
echo "🔧 Generating Kotlin bindings..."
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
echo "🎉 Parallel build complete! Ready for preview OR release deployment"
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "jniLibs structure:"
find "$OUTPUT_DIR/jniLibs" -type f 2>/dev/null || true
echo ""
echo "To use in Android:"
echo "  1. Copy jniLibs/* to android/app/src/main/jniLibs/"
echo "  2. Copy kotlin/* to your Kotlin source directory"
