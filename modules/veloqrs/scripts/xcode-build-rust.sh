#!/bin/sh
# Builds the Rust library from an Xcode script phase, for the SDK and
# architectures that build asks for.
#   $1  the directory holding React Native's .xcode.env, which names the node
#       to run, since Xcode started from the Dock has no shell PATH
#   $2  the directory the target links libveloqrs_ffi.a from
set -e

env_dir="$1"
out="$2"
for file in "$env_dir/.xcode.env" "$env_dir/.xcode.env.local"; do
  if [ -f "$file" ]; then
    . "$file"
  fi
done

exec "${NODE_BINARY:-node}" "$(dirname "$0")/build-rust.js" ios --from-xcode --out "$out"
