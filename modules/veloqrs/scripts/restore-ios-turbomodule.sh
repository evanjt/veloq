#!/usr/bin/env bash
# Put back the custom iOS TurboModule files, but only if the generator took them.
#
# `Veloqrs.h` and `Veloqrs.mm` expose installRustCrate/cleanupRustCrate alone.
# uniffi-bindgen-react-native writes its own pair declaring `NativeVeloqrsSpec`,
# which Codegen does not produce for a monorepo-local module, so the iOS build
# breaks. The canonical pair lives in git.
#
# This used to be an unconditional `git checkout --` with its errors suppressed,
# so it threw away hand edits to those two files every time any `generate:*`
# script ran, and said nothing. The generated pair names `NativeVeloqrsSpec` and
# the canonical pair does not, so that is what decides.
set -eu

module_dir="${1:-$(pwd)}"
cd "$module_dir"

git rev-parse --show-toplevel >/dev/null 2>&1 || exit 0
repo_root=$(git rev-parse --show-toplevel)
module_rel=$(pwd | sed "s|^$repo_root/||")

for name in Veloqrs.h Veloqrs.mm; do
  file="ios/$name"
  [ -f "$file" ] || continue
  if grep -q 'NativeVeloqrsSpec' "$file"; then
    echo "Restoring $file, the generator overwrote it"
    git -C "$repo_root" checkout -- "$module_rel/$file"
  fi
done
