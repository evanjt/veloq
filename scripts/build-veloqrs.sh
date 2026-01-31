#!/bin/bash
# Build veloqrs native libraries for Android or iOS
#
# Usage:
#   ./scripts/build-veloqrs.sh android [arch]    # Build for Android (default: arm64-v8a)
#   ./scripts/build-veloqrs.sh ios [target]      # Build for iOS (default: simulator)
#
# This script is used by both local development and CI.
# Bindings are committed to the repo - this only builds the native libraries.

set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM="${1:-}"
TARGET="${2:-}"

RUST_DIR="modules/veloqrs/rust"
MODULE_DIR="modules/veloqrs"

case "$PLATFORM" in
  android)
    ARCH="${TARGET:-arm64-v8a}"
    JNILIBS_DIR="$MODULE_DIR/android/src/main/jniLibs"

    echo "=== Building Rust for Android ($ARCH) ==="
    mkdir -p "$JNILIBS_DIR"

    cd "$RUST_DIR/veloqrs"
    cargo ndk -t "$ARCH" --platform 24 -o "../../android/src/main/jniLibs" build --release -p veloqrs

    echo "✓ Built libveloqrs.so for $ARCH"
    ls -la "../../android/src/main/jniLibs/$ARCH/"
    ;;

  ios)
    if [[ "$(uname)" != "Darwin" ]]; then
      echo "Error: iOS builds require macOS"
      exit 1
    fi

    TARGET="${TARGET:-simulator}"
    FRAMEWORKS_DIR="$MODULE_DIR/ios/Frameworks"

    echo "=== Building Rust for iOS ($TARGET) ==="
    cd "$RUST_DIR/veloqrs"

    case "$TARGET" in
      simulator)
        # Build for both arm64 and x86_64 simulators
        cargo build --release --target aarch64-apple-ios-sim -p veloqrs
        cargo build --release --target x86_64-apple-ios -p veloqrs

        # Create fat binary
        mkdir -p "../../ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64_x86_64-simulator"
        lipo -create \
          ../target/aarch64-apple-ios-sim/release/libveloqrs.a \
          ../target/x86_64-apple-ios/release/libveloqrs.a \
          -output "../../ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64_x86_64-simulator/libveloqrs_ffi.a"
        ;;
      device)
        # Build for arm64 device
        cargo build --release --target aarch64-apple-ios -p veloqrs

        mkdir -p "../../ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64"
        cp ../target/aarch64-apple-ios/release/libveloqrs.a \
          "../../ios/Frameworks/VeloqrsFFI.xcframework/ios-arm64/libveloqrs_ffi.a"
        ;;
      all)
        # Build for all targets and create full XCFramework
        cargo build --release --target aarch64-apple-ios -p veloqrs
        cargo build --release --target aarch64-apple-ios-sim -p veloqrs
        cargo build --release --target x86_64-apple-ios -p veloqrs

        # Create simulator fat binary
        mkdir -p /tmp/veloqrs-sim
        lipo -create \
          ../target/aarch64-apple-ios-sim/release/libveloqrs.a \
          ../target/x86_64-apple-ios/release/libveloqrs.a \
          -output /tmp/veloqrs-sim/libveloqrs.a

        # Create XCFramework
        rm -rf "../../ios/Frameworks/VeloqrsFFI.xcframework"
        xcodebuild -create-xcframework \
          -library ../target/aarch64-apple-ios/release/libveloqrs.a \
          -library /tmp/veloqrs-sim/libveloqrs.a \
          -output "../../ios/Frameworks/VeloqrsFFI.xcframework"
        ;;
      *)
        echo "Unknown iOS target: $TARGET"
        echo "Valid targets: simulator, device, all"
        exit 1
        ;;
    esac

    echo "✓ Built iOS libraries for $TARGET"
    ls -la "../../ios/Frameworks/"
    ;;

  *)
    echo "Usage: $0 <android|ios> [target]"
    echo ""
    echo "Android targets: arm64-v8a (default), armeabi-v7a, x86_64, x86"
    echo "iOS targets: simulator (default), device, all"
    exit 1
    ;;
esac

echo ""
echo "=== Build complete ==="
