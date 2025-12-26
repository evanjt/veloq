#!/bin/bash
set -e

# Build route-matcher for iOS
# Prerequisites:
#   - Rust with iOS targets: rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
#   - Xcode command line tools
#   - macOS (for xcodebuild)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_DIR}/target/ios"
SWIFT_DIR="${OUTPUT_DIR}/swift"

echo "============================================"
echo "Building route-matcher for iOS"
echo "============================================"
echo ""

cd "$PROJECT_DIR"

# Check prerequisites
echo "Checking prerequisites..."

# Check for required Rust targets
MISSING_TARGETS=""
for TARGET in aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
    if ! rustup target list --installed | grep -q "$TARGET"; then
        MISSING_TARGETS="$MISSING_TARGETS $TARGET"
    fi
done

if [ -n "$MISSING_TARGETS" ]; then
    echo "ERROR: Missing Rust targets:$MISSING_TARGETS"
    echo ""
    echo "Install with:"
    echo "  rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios"
    echo ""
    exit 1
fi

echo "All Rust targets installed ✓"
echo ""

# Build for all iOS targets
echo "Building for iOS device (aarch64-apple-ios)..."
cargo build --release --target aarch64-apple-ios --features full

echo ""
echo "Building for iOS simulator - Apple Silicon (aarch64-apple-ios-sim)..."
cargo build --release --target aarch64-apple-ios-sim --features full

echo ""
echo "Building for iOS simulator - Intel (x86_64-apple-ios)..."
cargo build --release --target x86_64-apple-ios --features full

# Create output directories
mkdir -p "$OUTPUT_DIR"
mkdir -p "$SWIFT_DIR"

# Create separate directories for device and simulator static libraries
# CocoaPods requires the library to have the SAME NAME in both slices of an XCFramework
DEVICE_LIB_DIR="$OUTPUT_DIR/device"
SIM_LIB_DIR="$OUTPUT_DIR/simulator"
mkdir -p "$DEVICE_LIB_DIR"
mkdir -p "$SIM_LIB_DIR"

# Create universal library for simulator (combines arm64 and x86_64)
echo ""
echo "Creating universal simulator library..."
lipo -create \
    target/aarch64-apple-ios-sim/release/libroute_matcher.a \
    target/x86_64-apple-ios/release/libroute_matcher.a \
    -output "$SIM_LIB_DIR/libroute_matcher.a"

# Copy device library (same name as simulator for XCFramework compatibility)
cp target/aarch64-apple-ios/release/libroute_matcher.a "$DEVICE_LIB_DIR/libroute_matcher.a"

# Also keep legacy named copies for backwards compatibility
cp "$DEVICE_LIB_DIR/libroute_matcher.a" "$OUTPUT_DIR/libroute_matcher_device.a"
cp "$SIM_LIB_DIR/libroute_matcher.a" "$OUTPUT_DIR/libroute_matcher_sim.a"

# Generate Swift bindings using the embedded uniffi-bindgen
echo ""
echo "Generating Swift bindings..."

# First, build the uniffi-bindgen binary for the host platform
echo "Building uniffi-bindgen..."
if ! cargo build --release --features ffi --bin uniffi-bindgen; then
    echo "ERROR: Failed to build uniffi-bindgen"
    exit 1
fi

# Generate Swift bindings
BINDGEN_SUCCESS=false

if cargo run --release --features ffi --bin uniffi-bindgen generate \
    --library target/aarch64-apple-ios/release/libroute_matcher.a \
    --language swift \
    --out-dir "$SWIFT_DIR"; then
    BINDGEN_SUCCESS=true
    echo "Swift bindings generated successfully ✓"
else
    # Fallback: try uniffi-bindgen from PATH
    if command -v uniffi-bindgen &> /dev/null; then
        echo "Falling back to system uniffi-bindgen..."
        if uniffi-bindgen generate \
            --library target/aarch64-apple-ios/release/libroute_matcher.a \
            --language swift \
            --out-dir "$SWIFT_DIR"; then
            BINDGEN_SUCCESS=true
            echo "Swift bindings generated successfully ✓"
        fi
    fi
fi

if [ "$BINDGEN_SUCCESS" = false ]; then
    echo ""
    echo "ERROR: Failed to generate Swift bindings."
    echo ""
    echo "This is required for iOS builds. To fix:"
    echo "  1. Ensure uniffi feature is enabled in Cargo.toml"
    echo "  2. Try: cargo install uniffi_bindgen@0.29"
    echo ""
    exit 1
fi

# Validate generated files
echo ""
echo "Validating generated bindings..."
if [ ! -f "$SWIFT_DIR/route_matcher.swift" ]; then
    echo "ERROR: route_matcher.swift not generated"
    exit 1
fi
if [ ! -f "$SWIFT_DIR/route_matcherFFI.h" ]; then
    echo "ERROR: route_matcherFFI.h not generated"
    exit 1
fi
echo "  ✓ route_matcher.swift"
echo "  ✓ route_matcherFFI.h"

# Create XCFramework (requires macOS with Xcode)
echo ""
echo "Creating XCFramework..."

# Check if we're on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Create module map for the C header
    HEADERS_DIR="$OUTPUT_DIR/headers"
    mkdir -p "$HEADERS_DIR"

    # Copy the generated header if it exists
    if [ -f "$SWIFT_DIR/route_matcherFFI.h" ]; then
        cp "$SWIFT_DIR/route_matcherFFI.h" "$HEADERS_DIR/"

        # Create module.modulemap
        # IMPORTANT: The module name must be "route_matcherFFI" (lowercase with underscore)
        # to match what UniFFI generates in the Swift bindings:
        #   #if canImport(route_matcherFFI)
        #   import route_matcherFFI
        cat > "$HEADERS_DIR/module.modulemap" << 'EOF'
module route_matcherFFI {
    header "route_matcherFFI.h"
    export *
}
EOF
    fi

    rm -rf "$OUTPUT_DIR/RouteMatcherFFI.xcframework"

    # Create XCFramework with headers
    # Use libraries from subdirectories so they have the same name (libroute_matcher.a)
    # This is required by CocoaPods for vendored XCFrameworks
    if [ -d "$HEADERS_DIR" ] && [ -f "$HEADERS_DIR/route_matcherFFI.h" ]; then
        xcodebuild -create-xcframework \
            -library "$DEVICE_LIB_DIR/libroute_matcher.a" \
            -headers "$HEADERS_DIR" \
            -library "$SIM_LIB_DIR/libroute_matcher.a" \
            -headers "$HEADERS_DIR" \
            -output "$OUTPUT_DIR/RouteMatcherFFI.xcframework"
        echo "XCFramework created successfully ✓"
    else
        # Create without headers
        xcodebuild -create-xcframework \
            -library "$DEVICE_LIB_DIR/libroute_matcher.a" \
            -library "$SIM_LIB_DIR/libroute_matcher.a" \
            -output "$OUTPUT_DIR/RouteMatcherFFI.xcframework"
        echo "XCFramework created (without headers) ✓"
    fi
else
    echo "Skipping XCFramework creation (requires macOS)"
    echo "The static libraries are available at:"
    echo "  - $OUTPUT_DIR/libroute_matcher_device.a (device)"
    echo "  - $OUTPUT_DIR/libroute_matcher_sim.a (simulator)"
fi

echo ""
echo "============================================"
echo "Build complete!"
echo "============================================"
echo ""
echo "Output directory: $OUTPUT_DIR"
echo ""
echo "Generated files:"
ls -la "$OUTPUT_DIR/" 2>/dev/null || true
echo ""
if [ -d "$SWIFT_DIR" ]; then
    echo "Swift bindings:"
    ls -la "$SWIFT_DIR/" 2>/dev/null || true
fi
echo ""
echo "Next step: Run ./scripts/install-ios.sh to copy files to the native module"
