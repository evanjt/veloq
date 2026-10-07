#!/bin/sh
set -eu

root=$(git rev-parse --show-toplevel)
common=$(git rev-parse --path-format=absolute --git-common-dir)
main=$(dirname "$common")
cd "$root"

if [ "$root" != "$main" ]; then
  if [ ! -d "$main/android" ]; then
    echo "Android project is missing from the main checkout" >&2
    exit 1
  fi
  mkdir -p android
  rsync -a --ignore-existing --exclude build --exclude .gradle --exclude .cxx \
    "$main/android/" android/
  if ! node scripts/check-native-tree.mjs >/dev/null 2>&1; then
    export npm_config_cache="$root/modules/veloqrs/rust/target/npm-cache"
    npm run setup:native
  fi
fi

export GRADLE_USER_HOME="$root/modules/veloqrs/rust/target/gradle-user"
npm run test:android:unit
