#!/bin/bash
# Capture all screenshots for both platforms and themes
# Usage: ./scripts/capture-all-screenshots.sh [platform]
# Example: ./scripts/capture-all-screenshots.sh ios

set -e

PLATFORM="${1:-all}"  # ios, android, or all
OUTPUT_DIR="screenshots"
SCRIPT_DIR="$(dirname "$0")"

# Clean output directory
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Function to run screenshot tests for a platform/theme combination
run_screenshots() {
    local platform=$1
    local theme=$2
    local config_name

    if [ "$platform" = "ios" ]; then
        config_name="ios.sim.release"
    else
        config_name="android.emu.release"
    fi

    echo ""
    echo "========================================"
    echo "Capturing $platform screenshots ($theme mode)"
    echo "========================================"

    # Set environment and run tests
    if [ "$theme" = "dark" ]; then
        SCREENSHOT_THEME=dark npx detox test --configuration "$config_name" --testNamePattern screenshots
    else
        npx detox test --configuration "$config_name" --testNamePattern screenshots
    fi

    # Collect screenshots from this run
    "$SCRIPT_DIR/collect-screenshots.sh" "$platform" "$theme"
}

# Run for iOS
if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "ios" ]; then
    echo "=== iOS Light Mode ==="
    run_screenshots "ios" "light"

    echo "=== iOS Dark Mode ==="
    run_screenshots "ios" "dark"
fi

# Run for Android
if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "android" ]; then
    echo "=== Android Light Mode ==="
    run_screenshots "android" "light"

    echo "=== Android Dark Mode ==="
    run_screenshots "android" "dark"
fi

echo ""
echo "========================================"
echo "All screenshots captured!"
echo "========================================"
echo ""
ls -la "$OUTPUT_DIR/"
