#!/usr/bin/env sh
# Build before taking the handset lock, then install and launch one pinned device.
#
#   scripts/run-android.sh dev metro          Veloq Dev, debug build, served by Metro
#   scripts/run-android.sh dev standalone     Veloq Dev, release build, embedded JavaScript
#   scripts/run-android.sh production         Veloq, which is only ever standalone
set -eu

cd "$(dirname "$0")/.."

# The identity and the compile mode are both named, so neither is read from
# whatever the caller exported, and a release build is not taken to mean Veloq.
usage() {
  echo "usage: scripts/run-android.sh dev metro|standalone, or production [standalone]" >&2
  exit 2
}
case "${1:-} ${2:-}" in
"dev metro") mode=metro ;;
"dev standalone") mode=standalone ;;
"production " | "production standalone") mode=standalone ;;
*) usage ;;
esac
[ "$#" -le 2 ] || usage
identity=$1
APP_VARIANT=$identity
export APP_VARIANT

# Select the device before either lock. Both adb and the device lock use this serial.
. scripts/device-lock-path.sh
veloq_refuse_if_ambiguous run-android || exit 2
veloq_refuse_if_not_test_device run-android || exit 2
if [ -z "$VELOQ_DEVICE_SERIAL" ]; then
  echo "run-android: connect a device or set ANDROID_SERIAL" >&2
  exit 2
fi
ANDROID_SERIAL=$VELOQ_DEVICE_SERIAL
export ANDROID_SERIAL

# Compile for the one ABI this handset loads, asked before the build lock is taken.
VELOQ_BUILD_ABI=$(veloq_device_abi)
export VELOQ_BUILD_ABI

# Dev never reaches a store, so its release build skips the code shrinker, resource
# shrinking and PNG crunching that only the store artefact needs. Production keeps all three.
VELOQ_RELEASE_PROPERTIES=
if [ "$identity" = dev ]; then
  VELOQ_RELEASE_PROPERTIES="-Pandroid.enableMinifyInReleaseBuilds=false -Pandroid.enableShrinkResourcesInReleaseBuilds=false -Pandroid.enablePngCrunchInReleaseBuilds=false"
fi
export VELOQ_RELEASE_PROPERTIES

# Gradle builds with the JDK the toolchain check passed, which it finds under
# the system JVM directory when the shell exported none.
# A Metro build compiles the engine with the local release-dev profile, which
# skips fat LTO and splits the crate into 16 codegen units, so an engine edit
# does not recompile it as one unit. Its timings are not the shipped engine's: a
# standalone build compiles release, as Gradle forces for every release build.
# The install reads the same variable to know which profile to expect.
if [ "$mode" = metro ]; then
  VELOQRS_RUST_PROFILE=${VELOQRS_RUST_PROFILE:-release-dev}
  export VELOQRS_RUST_PROFILE
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    JAVA_HOME=$(node scripts/check-toolchain.mjs --platform android --print-java-home)
    export JAVA_HOME
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    npm run bundle:android
    (cd android && ./gradlew assembleDebug -PreactNativeArchitectures="$VELOQ_BUILD_ABI")
    node scripts/build-record.js write debug
  '
else
  scripts/with-android-build-lock.sh sh -ec '
    node scripts/prepare-native.mjs --platform android
    JAVA_HOME=$(node scripts/check-toolchain.mjs --platform android --print-java-home)
    export JAVA_HOME
    node scripts/sync-android-widgets.mjs
    node scripts/check-native-tree.mjs
    node scripts/build-record.js snapshot android release
    (cd android && ./gradlew assembleRelease -PreactNativeArchitectures="$VELOQ_BUILD_ABI" $VELOQ_RELEASE_PROPERTIES)
    node scripts/build-record.js write release
  '
fi

# This process starts only after the build command exits and releases its lock.
scripts/install-and-launch-android.sh "$identity" "$mode"

if [ "$mode" = metro ]; then
  exec npx expo start --dev-client --localhost
fi
