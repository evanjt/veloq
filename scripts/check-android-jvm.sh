#!/bin/sh
set -eu

root=$(git rev-parse --show-toplevel)
common=$(git rev-parse --path-format=absolute --git-common-dir)
main=$(dirname "$common")
cd "$root"

if [ "$root" != "$main" ]; then
  # An input the generated project reads, untracked because it is per account.
  if [ ! -f google-services.json ] && [ -f "$main/google-services.json" ]; then
    cp "$main/google-services.json" google-services.json
  fi
  if ! node scripts/check-native-tree.mjs --installation >/dev/null 2>&1; then
    export npm_config_cache="$root/modules/veloqrs/rust/target/npm-cache"
    npm run setup:native
  fi
fi

# Expo generation owns android/. A tree that builds the other identity is
# regenerated from clean first, since a generation over it leaves the other
# Kotlin package beside the new one. Then, without --clean, generation fills in
# what is missing and applies the config to what is there, so a tree generated
# earlier keeps its Gradle outputs.
./scripts/with-android-build-lock.sh sh -ec '
  node scripts/prepare-native.mjs --platform android
  CI=1 npx expo prebuild --platform android --no-install
'

export GRADLE_USER_HOME="$root/modules/veloqrs/rust/target/gradle-user"
npm run test:android:unit
