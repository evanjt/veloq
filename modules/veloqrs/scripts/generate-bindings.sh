#!/bin/bash
# Regenerate the committed UniFFI bindings from the host library.
#
# The generator reads the metadata out of a compiled `.so`, so this needs no
# NDK, no device target and no cross-compile: a host release build is enough.
# `cargo metadata` has to find a manifest, which is why the generate step runs
# from the rust workspace and not from the module root.
#
# Run this after any change to an exported signature OR its doc comment: the
# export macro hashes the docstring into the item's checksum, so a comment
# alone moves it and a stale binding refuses to start the app (B286).
set -euo pipefail

cd "$(dirname "$0")/.."
MODULE_DIR=$(pwd)

cd rust
cargo build -p veloqrs --release
npx uniffi-bindgen-react-native generate jsi bindings \
  target/release/libveloqrs.so --library \
  --ts-dir ../src/generated --cpp-dir ../cpp/generated

cd "$MODULE_DIR"
# The generator emits unformatted TypeScript when it cannot resolve prettier.
npx prettier --no-config --write src/generated/veloqrs.ts src/generated/veloqrs-ffi.ts >/dev/null
./scripts/fix-generated.sh
