#!/bin/bash
# Collect screenshots from Detox artifacts and organize them
# Usage: ./scripts/collect-screenshots.sh [platform] [theme]
# Example: ./scripts/collect-screenshots.sh ios light

set -e

PLATFORM="${1:-all}"  # ios, android, or all
THEME="${2:-all}"     # light, dark, or all
OUTPUT_DIR="screenshots"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Function to collect screenshots from the latest artifact folder
collect_from_artifacts() {
    local platform=$1
    local theme=$2
    local config_name

    if [ "$platform" = "ios" ]; then
        config_name="ios.sim.release"
    else
        config_name="android.emu.release"
    fi

    # Find the latest artifact folder for this configuration
    local latest_dir
    latest_dir=$(ls -td artifacts/${config_name}* 2>/dev/null | head -1)

    if [ -z "$latest_dir" ]; then
        echo "No artifacts found for $platform"
        return 1
    fi

    echo "Collecting from: $latest_dir"

    # Find screenshot files (excluding testDone.png, device.log, and debug images)
    find "$latest_dir" -name "*.png" -type f | while read -r file; do
        filename=$(basename "$file")

        # Skip Detox auto-generated files
        if [[ "$filename" == "testDone.png" ]] || \
           [[ "$filename" == "testFnFailure.png" ]] || \
           [[ "$filename" == "beforeAllFailure.png" ]] || \
           [[ "$filename" == DETOX_* ]]; then
            continue
        fi

        # Extract the base name (e.g., "01-feed" from "01-feed.png" or "01-feed-dark.png")
        base_name="${filename%.png}"

        # Determine if this is dark theme based on filename
        if [[ "$base_name" == *"-dark" ]]; then
            actual_theme="dark"
            base_name="${base_name%-dark}"
        else
            actual_theme="light"
        fi

        # Skip if theme doesn't match filter
        if [ "$theme" != "all" ] && [ "$theme" != "$actual_theme" ]; then
            continue
        fi

        # Create new filename: 01-feed-light-ios.png
        new_name="${base_name}-${actual_theme}-${platform}.png"

        echo "  $filename -> $new_name"
        cp "$file" "$OUTPUT_DIR/$new_name"
    done
}

# Run collection based on parameters
if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "ios" ]; then
    echo "=== Collecting iOS screenshots ==="
    collect_from_artifacts "ios" "$THEME"
fi

if [ "$PLATFORM" = "all" ] || [ "$PLATFORM" = "android" ]; then
    echo "=== Collecting Android screenshots ==="
    collect_from_artifacts "android" "$THEME"
fi

echo ""
echo "Screenshots collected to: $OUTPUT_DIR/"
ls -la "$OUTPUT_DIR/"
