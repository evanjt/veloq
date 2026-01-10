#!/bin/bash
# Download prebuilt tracematch binaries from GitHub releases
set -e

# Read version from package.json (single source of truth)
VERSION="${TRACEMATCH_VERSION:-$(node -p "require('./package.json').tracematchVersion")}"
RELEASE_URL="https://github.com/evanjt/route-matcher/releases/download/${VERSION}"
MODULE_DIR="modules/route-matcher-native"

echo "Downloading tracematch v${VERSION}..."

# Create temp directory
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Download and extract Android
if [[ "$1" == "android" || "$1" == "all" || -z "$1" ]]; then
    echo "Downloading Android binaries..."
    curl -sL "${RELEASE_URL}/tracematch-android-${VERSION}.zip" -o "$TMP_DIR/android.zip"
    unzip -q "$TMP_DIR/android.zip" -d "$TMP_DIR"

    # Copy .so files to jniLibs
    mkdir -p "$MODULE_DIR/android/src/main/jniLibs"
    for arch in arm64-v8a armeabi-v7a x86_64 x86; do
        mkdir -p "$MODULE_DIR/android/src/main/jniLibs/$arch"
        cp "$TMP_DIR/android/jniLibs/$arch/libtracematch.so" \
           "$MODULE_DIR/android/src/main/jniLibs/$arch/"
        echo "  ✓ $arch"
    done

    # Copy Kotlin bindings
    mkdir -p "$MODULE_DIR/android/src/main/java/uniffi/tracematch"
    cp "$TMP_DIR/android/kotlin/uniffi/tracematch/tracematch.kt" \
       "$MODULE_DIR/android/src/main/java/uniffi/tracematch/"
    echo "  ✓ Kotlin bindings"
fi

# Download and extract iOS
if [[ "$1" == "ios" || "$1" == "all" || -z "$1" ]]; then
    echo "Downloading iOS binaries..."
    curl -sL "${RELEASE_URL}/tracematch-ios-${VERSION}.zip" -o "$TMP_DIR/ios.zip"
    unzip -q "$TMP_DIR/ios.zip" -d "$TMP_DIR"

    # Copy XCFramework
    mkdir -p "$MODULE_DIR/ios/Frameworks"
    rm -rf "$MODULE_DIR/ios/Frameworks/RouteMatcherFFI.xcframework"
    cp -r "$TMP_DIR/ios/RouteMatcherFFI.xcframework" "$MODULE_DIR/ios/Frameworks/"
    echo "  ✓ XCFramework"

    # Copy Swift bindings
    mkdir -p "$MODULE_DIR/ios/Generated"
    cp "$TMP_DIR/ios/Generated/tracematch.swift" "$MODULE_DIR/ios/Generated/"
    cp "$TMP_DIR/ios/Generated/tracematchFFI.h" "$MODULE_DIR/ios/Generated/"
    cp "$TMP_DIR/ios/Generated/tracematchFFI.modulemap" "$MODULE_DIR/ios/Generated/"
    echo "  ✓ Swift bindings"
fi

echo "Done! tracematch v${VERSION} installed."
