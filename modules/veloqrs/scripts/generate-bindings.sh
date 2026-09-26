#!/bin/bash
# Regenerate the committed UniFFI bindings from the host library.
# Exported signatures and doc comments both affect UniFFI checksums.
set -euo pipefail

cd "$(dirname "$0")/.."
MODULE_DIR=$(pwd)

cd rust
HOST=$(rustc -vV | sed -n 's/^host: //p')
if [ -z "$HOST" ]; then
  echo 'Could not determine the Rust host target' >&2
  exit 1
fi
ARTIFACTS=$(mktemp)
trap 'rm -f "$ARTIFACTS"' EXIT
cargo build -p veloqrs --release --target "$HOST" --message-format=json-render-diagnostics > "$ARTIFACTS"
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
  --ts-dir ../src/generated --cpp-dir ../cpp/generated

cd "$MODULE_DIR"
# The generator emits unformatted TypeScript when it cannot resolve prettier.
npx prettier --no-config --write src/generated/veloqrs.ts src/generated/veloqrs-ffi.ts >/dev/null
./scripts/fix-generated.sh
