#!/bin/bash
# Build tracematch native library for Android or iOS
# Usage: ./scripts/build-tracematch.sh [android|ios] [--release]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TRACEMATCH_DIR="$PROJECT_DIR/../tracematch"
MODULE_DIR="$PROJECT_DIR/src/modules/route-matcher-native"

PLATFORM="${1:-android}"
BUILD_TYPE="${2:---release}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[tracematch]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[tracematch]${NC} $1"
}

log_error() {
    echo -e "${RED}[tracematch]${NC} $1"
}

# Check tracematch directory exists
if [ ! -d "$TRACEMATCH_DIR" ]; then
    log_error "tracematch directory not found at: $TRACEMATCH_DIR"
    exit 1
fi

cd "$TRACEMATCH_DIR"
log_info "Building tracematch from: $TRACEMATCH_DIR"

if [ "$PLATFORM" = "android" ]; then
    log_info "Building for Android using cargo-ndk..."

    # Check cargo-ndk is available
    if ! command -v cargo-ndk &> /dev/null; then
        log_error "cargo-ndk not found. Install with: cargo install cargo-ndk"
        exit 1
    fi

    # Copy libraries to jniLibs
    JNILIBS_DIR="$MODULE_DIR/android/src/main/jniLibs"
    mkdir -p "$JNILIBS_DIR"

    # Build with cargo-ndk (handles all targets and NDK setup automatically)
    RELEASE_FLAG=""
    BUILD_SUBDIR="debug"
    if [ "$BUILD_TYPE" = "--release" ]; then
        RELEASE_FLAG="--release"
        BUILD_SUBDIR="release"
    fi

    # Build for all Android targets
    log_info "  Building arm64-v8a..."
    cargo ndk -t arm64-v8a -o "$JNILIBS_DIR" build $RELEASE_FLAG --features ffi 2>&1 | tail -3

    log_info "  Building armeabi-v7a..."
    cargo ndk -t armeabi-v7a -o "$JNILIBS_DIR" build $RELEASE_FLAG --features ffi 2>&1 | tail -3

    log_info "  Building x86_64..."
    cargo ndk -t x86_64 -o "$JNILIBS_DIR" build $RELEASE_FLAG --features ffi 2>&1 | tail -3

    log_info "  Building x86..."
    cargo ndk -t x86 -o "$JNILIBS_DIR" build $RELEASE_FLAG --features ffi 2>&1 | tail -3

    # Verify libraries are in place (should be libtracematch.so, NOT libveloq.so)
    # CMake builds libveloq.so (C++ wrapper) which links to libtracematch.so (Rust)
    for ARCH in arm64-v8a armeabi-v7a x86_64 x86; do
        if [ -f "$JNILIBS_DIR/$ARCH/libtracematch.so" ]; then
            log_info "  $ARCH/libtracematch.so ready"
        else
            log_warn "  $ARCH/libtracematch.so missing!"
        fi
    done

elif [ "$PLATFORM" = "ios" ]; then
    log_info "Building for iOS..."

    # iOS targets
    TARGETS=(
        "aarch64-apple-ios"
        "aarch64-apple-ios-sim"
        "x86_64-apple-ios"
    )

    for TARGET in "${TARGETS[@]}"; do
        log_info "  Building for $TARGET..."
        cargo build $BUILD_TYPE --features ffi --target "$TARGET" 2>&1 | tail -3
    done

    # Create XCFramework
    BUILD_SUBDIR="release"
    if [ "$BUILD_TYPE" != "--release" ]; then
        BUILD_SUBDIR="debug"
    fi

    FRAMEWORK_DIR="$MODULE_DIR/ios/TracematchFFI.xcframework"
    rm -rf "$FRAMEWORK_DIR"

    log_info "Creating XCFramework..."

    # Create fat library for simulator (arm64 + x86_64)
    SIMULATOR_FAT="$TRACEMATCH_DIR/target/ios-simulator-fat/libtracematch.a"
    mkdir -p "$(dirname "$SIMULATOR_FAT")"
    lipo -create \
        "$TRACEMATCH_DIR/target/aarch64-apple-ios-sim/$BUILD_SUBDIR/libtracematch.a" \
        "$TRACEMATCH_DIR/target/x86_64-apple-ios/$BUILD_SUBDIR/libtracematch.a" \
        -output "$SIMULATOR_FAT" 2>/dev/null || \
    cp "$TRACEMATCH_DIR/target/aarch64-apple-ios-sim/$BUILD_SUBDIR/libtracematch.a" "$SIMULATOR_FAT"

    xcodebuild -create-xcframework \
        -library "$TRACEMATCH_DIR/target/aarch64-apple-ios/$BUILD_SUBDIR/libtracematch.a" \
        -library "$SIMULATOR_FAT" \
        -output "$FRAMEWORK_DIR"

    log_info "Created XCFramework at: $FRAMEWORK_DIR"
else
    log_error "Unknown platform: $PLATFORM (use 'android' or 'ios')"
    exit 1
fi

log_info "Build complete!"
