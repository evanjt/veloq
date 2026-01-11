#!/bin/bash
# Smart Rust preparation script for development
# Automatically builds from local source if available, otherwise downloads releases
# Usage: ./scripts/prepare-rust.sh [android|ios|all]
set -e

TRACEMATCH_DIR="${TRACEMATCH_DIR:-../tracematch}"
PLATFORM="${1:-android}"

# Check if local tracematch repo exists
if [ -d "$TRACEMATCH_DIR" ] && [ -f "$TRACEMATCH_DIR/Cargo.toml" ]; then
    echo "Local tracematch found at $TRACEMATCH_DIR - building from source..."
    ./scripts/build-tracematch-local.sh "$PLATFORM"
else
    echo "No local tracematch found - downloading from GitHub releases..."
    ./scripts/download-tracematch.sh "$PLATFORM"
fi
