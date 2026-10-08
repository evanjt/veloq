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

# The generator npx resolves must be the one the lockfile records. A stale
# install can reject keys in uniffi.toml or emit bindings unlike the committed
# ones, and either way the old generated files stay in place, so refuse before
# building or writing anything. Paths are walked as node resolves them, without
# following the node_modules symlink a worktree shares with the main checkout.
node - "$MODULE_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const name = 'uniffi-bindgen-react-native';
const nearest = (start, relative) => {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, relative))) return dir;
    if (dir === path.dirname(dir)) return null;
  }
};
const refuse = (reason) => {
  console.error(`${reason}. Run npm ci at the repository root before generating bindings.`);
  process.exit(1);
};
const installDir = nearest(process.argv[2], path.join('node_modules', name, 'package.json'));
if (!installDir) refuse(`${name} is not installed`);
const lockDir = nearest(process.argv[2], 'package-lock.json');
if (!lockDir) refuse('No package-lock.json records which generator to run');
const installed = JSON.parse(
  fs.readFileSync(path.join(installDir, 'node_modules', name, 'package.json'), 'utf8')
).version;
const key = path.relative(lockDir, path.join(installDir, 'node_modules', name)).split(path.sep).join('/');
const packages = JSON.parse(fs.readFileSync(path.join(lockDir, 'package-lock.json'), 'utf8')).packages || {};
const locked = packages[key] && packages[key].version;
if (!locked) refuse(`package-lock.json records no ${name} at ${key}`);
if (installed !== locked) refuse(`${name} ${installed} is installed but package-lock.json records ${locked}`);
NODE

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
