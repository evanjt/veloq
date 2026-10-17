#!/usr/bin/env sh
# Print the one ABI a device build compiles for, for a recipe that cannot source
# the lock machinery itself:
#
#   ./gradlew assembleDebug -PreactNativeArchitectures="$(scripts/android-device-abi.sh)"
set -eu

. "$(dirname "$0")/device-lock-path.sh"
veloq_device_abi
