#!/bin/bash
# Print the path of a debug host build of the engine for this module's Rust
# source, building it only when this machine has none.
#
#   host-library.sh
#
# The bindings check regenerates the bindings from this library in every tree
# it runs in, so forty job trees at one commit compiled the same engine forty
# times. The library is a function of the Rust inputs (`rust-inputs.js`), the
# compiler and its flags, so one copy per machine under that key serves every
# tree. On a miss one run builds it holding the key's lock, and the others wait
# and take its copy. `VELOQ_ENGINE_CACHE` names the cache directory, and `off`
# builds in the tree every time.
set -euo pipefail

MODULE_DIR=$(cd "$(dirname "$0")/.." && pwd)
SCRIPTS="$MODULE_DIR/scripts"
cd "$MODULE_DIR/rust"

HOST=$(rustc -vV | sed -n 's/^host: //p')
if [ -z "$HOST" ]; then
  echo 'Could not determine the Rust host target' >&2
  exit 1
fi

ARTIFACTS=$(mktemp)
STAGE=
trap 'rm -f "$ARTIFACTS"; [ -z "$STAGE" ] || rm -rf "$STAGE"' EXIT

# The library this tree's own build writes, as cargo reports it.
build() {
  "$SCRIPTS/with-cargo-slot.sh" cargo build -p veloqrs --target "$HOST" \
    --message-format=json-render-diagnostics >"$ARTIFACTS"
  node - "$ARTIFACTS" <<'NODE'
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
}

CACHE=${VELOQ_ENGINE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/veloq/host-library}
if [ "$CACHE" = off ]; then
  build
  exit 0
fi

# The build takes no features, so the hash must not take the ones a native
# build exports either.
KEY=$({
  VELOQRS_CARGO_FEATURES='' node "$SCRIPTS/rust-inputs.js" .
  rustc -vV
  printf 'RUSTFLAGS=%s\nCARGO_ENCODED_RUSTFLAGS=%s\n' "${RUSTFLAGS:-}" "${CARGO_ENCODED_RUSTFLAGS:-}"
} | node -e "process.stdout.write(require('crypto').createHash('sha256')
  .update(require('fs').readFileSync(0)).digest('hex').slice(0, 16))")
ENTRY="$CACHE/$KEY"

cached() {
  local library
  for library in "$ENTRY/libveloqrs.so" "$ENTRY/libveloqrs.dylib"; do
    if [ -f "$library" ]; then
      touch "$ENTRY"
      printf '%s' "$library"
      return 0
    fi
  done
  return 1
}

# Keep the newest few entries, and never one read within the hour, which a
# run that has just printed its path may still be reading.
prune() {
  local keep=${VELOQ_ENGINE_CACHE_KEEP:-6} entry
  ls -dt "$CACHE"/*/ | tail -n +"$((keep + 1))" | while read -r entry; do
    entry=${entry%/}
    if [ -n "$(find "$entry" -maxdepth 0 -mmin +60)" ]; then
      rm -rf "$entry" "$entry.lock"
    fi
  done
}

cached && exit 0

mkdir -p "$CACHE"
if command -v flock >/dev/null; then
  exec {lock}>>"$ENTRY.lock"
  if ! flock -n "$lock"; then
    echo "host-library: another tree is building the engine at $KEY, waiting for it" >&2
    flock "$lock"
  fi
  cached && exit 0
fi

LIBRARY=$(build)
STAGE=$(mktemp -d "$CACHE/.$KEY.XXXXXX")
cp "$LIBRARY" "$STAGE/"
chmod a-w "$STAGE/$(basename "$LIBRARY")"
rm -rf "$ENTRY"
mv "$STAGE" "$ENTRY"
STAGE=
prune || true
cached
