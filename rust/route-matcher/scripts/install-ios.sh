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
    echo "  ✗ XCFramework NOT FOUND at $SOURCE_DIR/RouteMatcherFFI.xcframework"
fi

# Install Swift bindings
echo ""
echo "Installing Swift bindings..."

HEADERS_DIR="${SOURCE_DIR}/headers"
INSTALL_ERRORS=0

# Copy the generated Swift file (UniFFI generates route_matcher.swift)
if [ -f "$SWIFT_SOURCE/route_matcher.swift" ]; then
    cp "$SWIFT_SOURCE/route_matcher.swift" "$MODULE_DIR/Generated/"
    echo "  ✓ route_matcher.swift (UniFFI bindings)"
else
    echo "  ✗ route_matcher.swift NOT FOUND"
    INSTALL_ERRORS=$((INSTALL_ERRORS + 1))
fi

# Copy the C header (needed for FFI)
if [ -f "$SWIFT_SOURCE/route_matcherFFI.h" ]; then
    cp "$SWIFT_SOURCE/route_matcherFFI.h" "$MODULE_DIR/Generated/"
    echo "  ✓ route_matcherFFI.h (C header)"
else
    echo "  ✗ route_matcherFFI.h NOT FOUND"
    INSTALL_ERRORS=$((INSTALL_ERRORS + 1))
fi

# Copy the module.modulemap from headers directory (needed for Swift imports)
if [ -f "$HEADERS_DIR/module.modulemap" ]; then
    cp "$HEADERS_DIR/module.modulemap" "$MODULE_DIR/Generated/"
    echo "  ✓ module.modulemap (Swift module definition)"
else
    echo "  ✗ module.modulemap NOT FOUND"
    INSTALL_ERRORS=$((INSTALL_ERRORS + 1))
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

# Validate all required files are present
MISSING=""
[ ! -d "$MODULE_DIR/Frameworks/RouteMatcherFFI.xcframework" ] && MISSING="$MISSING RouteMatcherFFI.xcframework"
[ ! -f "$MODULE_DIR/Generated/route_matcher.swift" ] && MISSING="$MISSING route_matcher.swift"
[ ! -f "$MODULE_DIR/Generated/route_matcherFFI.h" ] && MISSING="$MISSING route_matcherFFI.h"
[ ! -f "$MODULE_DIR/Generated/module.modulemap" ] && MISSING="$MISSING module.modulemap"

if [ -z "$MISSING" ]; then
    echo "✓ Native implementation ready!"
else
    echo "ERROR: Native implementation incomplete!"
    echo ""
    echo "Missing components:$MISSING"
    echo ""
    echo "The iOS build WILL FAIL without these files."
    echo "Run build-ios.sh first to generate all required artifacts."
    exit 1
fi
