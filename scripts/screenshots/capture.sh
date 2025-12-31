#!/bin/bash
# Screenshot capture helper for Veloq website
# Usage: ./capture.sh [name]

set -e

SCREENSHOT_DIR="$(dirname "$0")/screenshots"
mkdir -p "$SCREENSHOT_DIR"

# Enter immersive mode
echo "Entering immersive mode..."
adb shell settings put global policy_control immersive.full=*

# Trap to restore on exit
trap 'echo "Restoring system UI..."; adb shell settings put global policy_control null' EXIT

if [ -n "$1" ]; then
    # Single capture with name
    FILE="$SCREENSHOT_DIR/$1.png"
    echo "Capturing $FILE..."
    adb exec-out screencap -p > "$FILE"
    echo "Saved: $FILE"
else
    # Interactive mode
    SCREENSHOTS="01-feed 02-activity-map 03-activity-3d 04-charts 05-fitness 06-regional-map 07-routes 08-performance"

    # Function to show status of all screenshots
    show_status() {
        echo ""
        echo "Screenshot Status:"
        for name in $SCREENSHOTS; do
            file="$SCREENSHOT_DIR/$name.png"
            if [ -f "$file" ]; then
                timestamp=$(stat -c '%y' "$file" 2>/dev/null || stat -f '%Sm' "$file" 2>/dev/null)
                timestamp=${timestamp%.*}  # Remove subseconds
                echo "  ✓ $name  ($timestamp)"
            else
                echo "  · $name  (missing)"
            fi
        done
        echo ""
    }

    # Show initial status
    show_status

    echo "Commands:"
    echo "  1, f : 01-feed         (Activity Feed)"
    echo "  2, m : 02-activity-map (Activity Map)"
    echo "  3, d : 03-activity-3d  (3D Terrain View)"
    echo "  4, c : 04-charts       (Multi-Metric Charts)"
    echo "  5, t : 05-fitness      (Fitness Tracking)"
    echo "  6, r : 06-regional-map (Regional Map)"
    echo "  7, o : 07-routes       (Route Detection)"
    echo "  8, p : 08-performance  (Performance Curves)"
    echo "  s    : Show status"
    echo "  q    : Quit"
    echo ""

    while true; do
        read -p "Capture: " -n1 key
        echo ""

        case $key in
            1|f) FILE="$SCREENSHOT_DIR/01-feed.png"; NAME="01-feed" ;;
            2|m) FILE="$SCREENSHOT_DIR/02-activity-map.png"; NAME="02-activity-map" ;;
            3|d) FILE="$SCREENSHOT_DIR/03-activity-3d.png"; NAME="03-activity-3d" ;;
            4|c) FILE="$SCREENSHOT_DIR/04-charts.png"; NAME="04-charts" ;;
            5|t) FILE="$SCREENSHOT_DIR/05-fitness.png"; NAME="05-fitness" ;;
            6|r) FILE="$SCREENSHOT_DIR/06-regional-map.png"; NAME="06-regional-map" ;;
            7|o) FILE="$SCREENSHOT_DIR/07-routes.png"; NAME="07-routes" ;;
            8|p) FILE="$SCREENSHOT_DIR/08-performance.png"; NAME="08-performance" ;;
            s) show_status; continue ;;
            q) break ;;
            *) echo "Unknown key"; continue ;;
        esac

        adb exec-out screencap -p > "$FILE"
        echo "✓ Saved: $FILE"

        # Show updated status
        show_status
    done
fi

echo ""
echo "Screenshots saved to $SCREENSHOT_DIR"
ls -la "$SCREENSHOT_DIR"/*.png 2>/dev/null || echo "(no screenshots yet)"
