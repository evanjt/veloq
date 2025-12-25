#!/bin/bash
set -e

# Install compiled Android libraries to the Expo native module
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULE_DIR="${PROJECT_DIR}/../../modules/route-matcher-native/android/src/main"

echo "Installing Android libraries to native module..."

# Create jniLibs directories if they don't exist
mkdir -p "$MODULE_DIR/jniLibs/arm64-v8a"
mkdir -p "$MODULE_DIR/jniLibs/armeabi-v7a"
mkdir -p "$MODULE_DIR/jniLibs/x86_64"
mkdir -p "$MODULE_DIR/jniLibs/x86"

# Copy libraries
if [ -d "$PROJECT_DIR/target/android/jniLibs" ]; then
    cp -v "$PROJECT_DIR/target/android/jniLibs/arm64-v8a/libroute_matcher.so" "$MODULE_DIR/jniLibs/arm64-v8a/" 2>/dev/null || echo "arm64-v8a not found"
    cp -v "$PROJECT_DIR/target/android/jniLibs/armeabi-v7a/libroute_matcher.so" "$MODULE_DIR/jniLibs/armeabi-v7a/" 2>/dev/null || echo "armeabi-v7a not found"
    cp -v "$PROJECT_DIR/target/android/jniLibs/x86_64/libroute_matcher.so" "$MODULE_DIR/jniLibs/x86_64/" 2>/dev/null || echo "x86_64 not found"
    cp -v "$PROJECT_DIR/target/android/jniLibs/x86/libroute_matcher.so" "$MODULE_DIR/jniLibs/x86/" 2>/dev/null || echo "x86 not found"
    echo "Android libraries installed successfully!"
else
    echo "Error: Android libraries not found. Run build-android.sh first."
    exit 1
fi

# Copy Kotlin bindings if they exist
if [ -d "$PROJECT_DIR/target/android/kotlin" ]; then
    KOTLIN_DIR="$MODULE_DIR/java"
    mkdir -p "$KOTLIN_DIR"
    cp -rv "$PROJECT_DIR/target/android/kotlin/"* "$KOTLIN_DIR/" 2>/dev/null || echo "Kotlin bindings not found"
    echo "Kotlin bindings installed!"
fi

echo ""
echo "Installation complete!"
ls -la "$MODULE_DIR/jniLibs/"*/ 2>/dev/null || true
