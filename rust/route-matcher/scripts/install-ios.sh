#!/bin/bash
set -e

# Install compiled iOS libraries to the Expo native module
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULE_DIR="${PROJECT_DIR}/../../modules/route-matcher-native/ios"
SOURCE_DIR="${PROJECT_DIR}/target/ios"
SWIFT_SOURCE="${SOURCE_DIR}/swift"

echo "============================================"
echo "Installing iOS libraries to native module"
echo "============================================"
echo ""
echo "Source: $SOURCE_DIR"
echo "Target: $MODULE_DIR"
echo ""

# Check if source exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "ERROR: iOS libraries not found at $SOURCE_DIR"
    echo "Run build-ios.sh first."
    exit 1
fi

# Create directories
mkdir -p "$MODULE_DIR/Frameworks"
mkdir -p "$MODULE_DIR/Generated"

# Install XCFramework
if [ -d "$SOURCE_DIR/RouteMatcherFFI.xcframework" ]; then
    echo "Installing XCFramework..."
    rm -rf "$MODULE_DIR/Frameworks/RouteMatcherFFI.xcframework"
    cp -r "$SOURCE_DIR/RouteMatcherFFI.xcframework" "$MODULE_DIR/Frameworks/"
    echo "  ✓ RouteMatcherFFI.xcframework"
else
    echo "WARNING: XCFramework not found - native module will use fallback"
fi

# Install Swift bindings
if [ -d "$SWIFT_SOURCE" ]; then
    echo ""
    echo "Installing Swift bindings..."

    # Copy the generated Swift file (UniFFI generates route_matcher.swift)
    if [ -f "$SWIFT_SOURCE/route_matcher.swift" ]; then
        cp "$SWIFT_SOURCE/route_matcher.swift" "$MODULE_DIR/Generated/"
        echo "  ✓ route_matcher.swift (UniFFI bindings)"
    fi

    # Copy the C header (needed for bridging)
    if [ -f "$SWIFT_SOURCE/route_matcherFFI.h" ]; then
        cp "$SWIFT_SOURCE/route_matcherFFI.h" "$MODULE_DIR/Generated/"
        echo "  ✓ route_matcherFFI.h (C header)"
    fi

    # Create bridging header if it doesn't exist
    BRIDGING_HEADER="$MODULE_DIR/RouteMatcherNative-Bridging-Header.h"
    if [ ! -f "$BRIDGING_HEADER" ]; then
        echo "Creating bridging header..."
        cat > "$BRIDGING_HEADER" << 'EOF'
//
//  RouteMatcherNative-Bridging-Header.h
//  Bridges the Rust FFI C header for Swift
//

#import "Generated/route_matcherFFI.h"
EOF
        echo "  ✓ RouteMatcherNative-Bridging-Header.h"
    fi
else
    echo ""
    echo "WARNING: Swift bindings not found at $SWIFT_SOURCE"
    echo "The module will use JavaScript fallback implementation."
fi

echo ""
echo "============================================"
echo "Installation complete!"
echo "============================================"
echo ""
echo "Installed files:"
echo ""
echo "Frameworks:"
ls -la "$MODULE_DIR/Frameworks/" 2>/dev/null || echo "  (none)"
echo ""
echo "Generated:"
ls -la "$MODULE_DIR/Generated/" 2>/dev/null || echo "  (none)"
echo ""

# Check if we have everything needed for native implementation
if [ -d "$MODULE_DIR/Frameworks/RouteMatcherFFI.xcframework" ] && \
   [ -f "$MODULE_DIR/Generated/route_matcher.swift" ]; then
    echo "✓ Native implementation ready!"
    echo ""
    echo "Update RouteMatcherModule.swift to import and use the generated bindings."
else
    echo "⚠ Native implementation incomplete - will use JavaScript fallback"
    echo ""
    echo "Missing components:"
    [ ! -d "$MODULE_DIR/Frameworks/RouteMatcherFFI.xcframework" ] && echo "  - RouteMatcherFFI.xcframework"
    [ ! -f "$MODULE_DIR/Generated/route_matcher.swift" ] && echo "  - route_matcher.swift"
fi
