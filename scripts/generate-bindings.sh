#!/bin/bash
# Regenerate UniFFI bindings when Rust FFI changes
#
# This script regenerates ONLY the TypeScript and C++ bindings.
# It does NOT regenerate the turbo-module wrappers (cpp/veloqrs.h, cpp/veloqrs.cpp)
# or platform-specific files (ios/Veloqrs.h, android/VeloqrsModule.kt).
#
# Run from veloq/ directory after modifying Rust #[uniffi::export] functions,
# then commit the regenerated bindings.
#
# Usage:
#   ./scripts/generate-bindings.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Building Rust for host platform ==="
cd modules/veloqrs/rust

cargo build --release -p veloqrs

# Detect library extension
LIB_EXT="so"
[ "$(uname)" = "Darwin" ] && LIB_EXT="dylib"

LIB_PATH="target/release/libveloqrs.$LIB_EXT"
if [ ! -f "$LIB_PATH" ]; then
  echo "Error: Library not found at $LIB_PATH"
  echo "Make sure Rust build completed successfully"
  exit 1
fi

echo "=== Generating UniFFI bindings ==="
# Generate ONLY the TypeScript and C++ bindings
# This does NOT regenerate turbo-module wrappers or platform files
npx uniffi-bindgen-react-native generate jsi bindings \
  --ts-dir ../src/generated \
  --cpp-dir ../cpp/generated \
  --library "$LIB_PATH"

echo "✓ Generated TypeScript bindings in src/generated/"
echo "✓ Generated C++ bindings in cpp/generated/"

# Show what was generated
echo ""
echo "=== Generated files ==="
ls -la ../src/generated/
ls -la ../cpp/generated/

echo ""
echo "=== Next steps ==="
echo "Commit the regenerated bindings:"
echo "  git add modules/veloqrs/src/generated modules/veloqrs/cpp/generated"
echo "  git commit -m 'regenerate UniFFI bindings'"
echo ""
echo "NOTE: This script does NOT regenerate:"
echo "  - cpp/veloqrs.h, cpp/veloqrs.cpp (turbo-module wrappers)"
echo "  - ios/Veloqrs.h, ios/Veloqrs.mm (platform wrappers)"
echo "  - android VeloqrsModule.kt (platform wrappers)"
echo "These rarely need changes. Update manually if the FFI interface changes."
