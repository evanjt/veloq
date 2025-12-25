#!/bin/bash
set -e

# Install compiled iOS libraries to the Expo native module
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULE_DIR="${PROJECT_DIR}/../../modules/route-matcher-native/ios"

echo "Installing iOS libraries to native module..."

# Create directories if they don't exist
mkdir -p "$MODULE_DIR/Frameworks"

# Copy libraries
if [ -d "$PROJECT_DIR/target/ios" ]; then
    # Copy XCFramework if it exists
    if [ -d "$PROJECT_DIR/target/ios/RouteMatcherFFI.xcframework" ]; then
        cp -rv "$PROJECT_DIR/target/ios/RouteMatcherFFI.xcframework" "$MODULE_DIR/Frameworks/"
        echo "XCFramework installed!"
    else
        # Fallback: copy static libraries directly
        cp -v "$PROJECT_DIR/target/ios/libroute_matcher_device.a" "$MODULE_DIR/" 2>/dev/null || echo "Device library not found"
        cp -v "$PROJECT_DIR/target/ios/libroute_matcher_sim.a" "$MODULE_DIR/" 2>/dev/null || echo "Simulator library not found"
        echo "Static libraries installed!"
    fi

    # Copy Swift bindings if they exist
    if [ -d "$PROJECT_DIR/target/ios/swift" ]; then
        cp -rv "$PROJECT_DIR/target/ios/swift/"* "$MODULE_DIR/" 2>/dev/null || echo "Swift bindings not found"
        echo "Swift bindings installed!"
    fi

    echo "iOS libraries installed successfully!"
else
    echo "Error: iOS libraries not found. Run build-ios.sh first."
    exit 1
fi

echo ""
echo "Installation complete!"
ls -la "$MODULE_DIR/"*.a "$MODULE_DIR/Frameworks" 2>/dev/null || true
