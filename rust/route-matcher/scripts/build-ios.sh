#!/bin/bash
set -e

# Build route-matcher for iOS
# Prerequisites:
#   - Rust with iOS targets: rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
#   - Xcode command line tools

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_DIR}/target/ios"

echo "Building route-matcher for iOS..."
cd "$PROJECT_DIR"

# Build for iOS device (arm64)
echo "Building for aarch64-apple-ios (device)..."
cargo build --release --target aarch64-apple-ios --features ffi,parallel

# Build for iOS simulator (arm64 - Apple Silicon)
echo "Building for aarch64-apple-ios-sim (Apple Silicon simulator)..."
cargo build --release --target aarch64-apple-ios-sim --features ffi,parallel

# Build for iOS simulator (x86_64 - Intel)
echo "Building for x86_64-apple-ios (Intel simulator)..."
cargo build --release --target x86_64-apple-ios --features ffi,parallel

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Create universal library for simulator (combines arm64 and x86_64)
echo "Creating universal simulator library..."
lipo -create \
    target/aarch64-apple-ios-sim/release/libroute_matcher.a \
    target/x86_64-apple-ios/release/libroute_matcher.a \
    -output "$OUTPUT_DIR/libroute_matcher_sim.a"

# Copy device library
cp target/aarch64-apple-ios/release/libroute_matcher.a "$OUTPUT_DIR/libroute_matcher_device.a"

# Generate Swift bindings
echo "Generating Swift bindings..."
cargo run --features ffi --bin uniffi-bindgen generate \
    --library target/aarch64-apple-ios/release/libroute_matcher.a \
    --language swift \
    --out-dir "$OUTPUT_DIR/swift" 2>/dev/null || {
    # Fallback: use uniffi-bindgen-cli if available
    echo "Using uniffi-bindgen CLI..."
    uniffi-bindgen generate \
        --library target/aarch64-apple-ios/release/libroute_matcher.a \
        --language swift \
        --out-dir "$OUTPUT_DIR/swift" 2>/dev/null || {
        echo "Note: Swift bindings generation skipped (uniffi-bindgen not available)"
        echo "Install with: cargo install uniffi_bindgen"
    }
}

# Create XCFramework
echo "Creating XCFramework..."
rm -rf "$OUTPUT_DIR/RouteMatcherFFI.xcframework"
xcodebuild -create-xcframework \
    -library "$OUTPUT_DIR/libroute_matcher_device.a" \
    -library "$OUTPUT_DIR/libroute_matcher_sim.a" \
    -output "$OUTPUT_DIR/RouteMatcherFFI.xcframework" 2>/dev/null || {
    echo "Note: XCFramework creation skipped (run on macOS)"
}

echo ""
echo "Build complete!"
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "Files:"
ls -la "$OUTPUT_DIR/" 2>/dev/null || true
