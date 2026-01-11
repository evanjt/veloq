#!/bin/bash
# Build tracematch locally for development
# Usage: ./scripts/build-tracematch-local.sh [android|ios|all]
set -e

TRACEMATCH_DIR="${TRACEMATCH_DIR:-../tracematch}"
MODULE_DIR="modules/route-matcher-native"
PLATFORM="${1:-android}"

# Verify tracematch directory exists
if [ ! -d "$TRACEMATCH_DIR" ]; then
    echo "Error: tracematch directory not found at $TRACEMATCH_DIR"
    echo "Set TRACEMATCH_DIR environment variable to point to the tracematch repo"
    exit 1
fi

echo "Building tracematch from $TRACEMATCH_DIR..."

build_android() {
    echo ""
    echo "=== Building Android ==="
    cd "$TRACEMATCH_DIR"

    # Build for all Android architectures
    echo "Building native libraries..."
    cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -t x86 \
        --platform 24 \
        -o target/android/jniLibs \
        build --release

    # Generate Kotlin bindings using the project's uniffi-bindgen
    echo "Generating Kotlin bindings..."
    # Use one of the built .so files as the library source
    cargo run --release --bin uniffi-bindgen -- generate \
        --library target/android/jniLibs/arm64-v8a/libtracematch.so \
        --language kotlin \
        --out-dir target/android/kotlin

    cd - > /dev/null

    # Copy to veloq module
    echo "Copying to veloq module..."
    for arch in arm64-v8a armeabi-v7a x86_64 x86; do
        mkdir -p "$MODULE_DIR/android/src/main/jniLibs/$arch"
        cp "$TRACEMATCH_DIR/target/android/jniLibs/$arch/libtracematch.so" \
           "$MODULE_DIR/android/src/main/jniLibs/$arch/"
        echo "  ✓ $arch"
    done

    # Copy Kotlin bindings
    mkdir -p "$MODULE_DIR/android/src/main/java/uniffi/tracematch"
    cp "$TRACEMATCH_DIR/target/android/kotlin/uniffi/tracematch/tracematch.kt" \
       "$MODULE_DIR/android/src/main/java/uniffi/tracematch/"
    echo "  ✓ Kotlin bindings"
}

build_ios() {
    echo ""
    echo "=== Building iOS ==="
    cd "$TRACEMATCH_DIR"

    # Build for iOS architectures
    echo "Building native libraries..."
    cargo build --release --target aarch64-apple-ios
    cargo build --release --target aarch64-apple-ios-sim
    cargo build --release --target x86_64-apple-ios

    # Create XCFramework
    echo "Creating XCFramework..."
    mkdir -p target/ios

    # Create fat library for simulator (arm64 + x86_64)
    lipo -create \
        target/aarch64-apple-ios-sim/release/libtracematch.a \
        target/x86_64-apple-ios/release/libtracematch.a \
        -output target/ios/libtracematch-sim.a

    xcodebuild -create-xcframework \
        -library target/aarch64-apple-ios/release/libtracematch.a \
        -library target/ios/libtracematch-sim.a \
        -output target/ios/RouteMatcherFFI.xcframework

    # Generate Swift bindings
    echo "Generating Swift bindings..."
    cargo build --release --features ffi
    uniffi-bindgen generate \
        --library target/release/libtracematch.dylib \
        --language swift \
        --out-dir target/ios/Generated

    cd - > /dev/null

    # Copy to veloq module
    echo "Copying to veloq module..."
    mkdir -p "$MODULE_DIR/ios/Frameworks"
    rm -rf "$MODULE_DIR/ios/Frameworks/RouteMatcherFFI.xcframework"
    cp -r "$TRACEMATCH_DIR/target/ios/RouteMatcherFFI.xcframework" "$MODULE_DIR/ios/Frameworks/"
    echo "  ✓ XCFramework"

    mkdir -p "$MODULE_DIR/ios/Generated"
    cp "$TRACEMATCH_DIR/target/ios/Generated/tracematch.swift" "$MODULE_DIR/ios/Generated/"
    cp "$TRACEMATCH_DIR/target/ios/Generated/tracematchFFI.h" "$MODULE_DIR/ios/Generated/"
    cp "$TRACEMATCH_DIR/target/ios/Generated/tracematchFFI.modulemap" "$MODULE_DIR/ios/Generated/"
    echo "  ✓ Swift bindings"
}

case "$PLATFORM" in
    android)
        build_android
        ;;
    ios)
        build_ios
        ;;
    all)
        build_android
        build_ios
        ;;
    *)
        echo "Usage: $0 [android|ios|all]"
        exit 1
        ;;
esac

echo ""
echo "Done! Local build complete."
echo "Run 'npx expo run:android' to test."
