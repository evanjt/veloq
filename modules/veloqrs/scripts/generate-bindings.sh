#!/bin/bash
# Regenerate the committed UniFFI bindings from the host library.
# Exported signatures and doc comments both affect UniFFI checksums.
# A debug host build carries the same metadata as release and is far quicker.
# This is the one generator: CI and the merge gate run it through npm run ffi:generate.
set -euo pipefail

cd "$(dirname "$0")/.."
MODULE_DIR=$(pwd)
OUTPUT_DIR="$MODULE_DIR"
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != '--out-dir' ]; then
    echo 'Usage: generate-bindings.sh [--out-dir <module-output-directory>]' >&2
    exit 1
  fi
  mkdir -p "$2"
  OUTPUT_DIR=$(cd "$2" && pwd)
fi

cd rust
HOST=$(rustc -vV | sed -n 's/^host: //p')
if [ -z "$HOST" ]; then
  echo 'Could not determine the Rust host target' >&2
  exit 1
fi
ARTIFACTS=$(mktemp)
trap 'rm -f "$ARTIFACTS"' EXIT
cargo build -p veloqrs --target "$HOST" --message-format=json-render-diagnostics > "$ARTIFACTS"
LIBRARY=$(node - "$ARTIFACTS" <<'NODE'
const fs = require('fs');
const messages = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const libraries = messages
  .filter(message => message.reason === 'compiler-artifact' && message.target.name === 'veloqrs')
  .flatMap(message => message.filenames)
  .filter(filename => /\.(so|dylib)$/.test(filename));
if (libraries.length !== 1 || !fs.existsSync(libraries[0])) {
  console.error(`Host library not found in Cargo output: ${libraries.join(', ') || 'no shared library reported'}`);
  process.exit(1);
}
process.stdout.write(libraries[0]);
NODE
)
npx uniffi-bindgen-react-native generate jsi bindings \
  "$LIBRARY" --library \
  --ts-dir "$OUTPUT_DIR/src/generated" --cpp-dir "$OUTPUT_DIR/cpp/generated"

cd "$MODULE_DIR"
# The generator emits unformatted TypeScript when it cannot resolve prettier.
npx prettier --no-config --write "$OUTPUT_DIR/src/generated/veloqrs.ts" "$OUTPUT_DIR/src/generated/veloqrs-ffi.ts" >/dev/null
cd "$OUTPUT_DIR"
"$MODULE_DIR/scripts/fix-generated.sh"
