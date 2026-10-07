#!/bin/bash
# Install an APK only when it is the build of the tree you are on.
#
# An APK outlives its checkout and says nothing about itself. One cut at 13:14
# on 2026-09-19 was installed at 21:36, eight hours and one merge later, and
# ran without the fix it had been installed to test. The build was green, the
# install was green, and the staleness was diagnosed afterwards from git
# timestamps alone.
#
# A commit stamp cannot settle it: two builds off one dirty tree carry the same
# commit, and the bundle and Rust library Gradle packages can be older than the
# configuration that stamped them. So the check is the build record
# `npm run android:debug` or `npm run android:prod` writes beside the APK
# (`scripts/lib/build-record.js`):
# the bundle and libraries the APK carries must be the recorded ones, the
# recorded inputs must be the tree's, and the identity, Rust profile, features
# and ABIs must be the ones asked for and the handset runs.
#
#   scripts/install-apk.sh debug                      # refuses anything else
#   scripts/install-apk.sh debug --features lock-trace
#   scripts/install-apk.sh release --stale            # install it anyway, knowingly
#   scripts/install-apk.sh old/before.apk --stale     # a named file, same checks
set -eu

# A named file is read from where the caller stood, before the cd below.
case "${1:-}" in
*.apk)
  case "$1" in
  /*) ;;
  *) set -- "$PWD/$1" "${@:2}" ;;
  esac
  ;;
esac

# One thing at a time against one handset: an install kills whatever is running
# on it, so a measurement in another session loses its app mid-run.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

cd "$(dirname "$0")/.."

VARIANT=${1:-debug}
ALLOW_STALE=0
EXPECT=()
shift || true
while [ "$#" -gt 0 ]; do
  case "$1" in
  --stale) ALLOW_STALE=1 ;;
  --app-id | --profile | --features)
    if [ "$#" -lt 2 ]; then
      echo "install-apk: $1 needs a value" >&2
      exit 2
    fi
    EXPECT+=("$1" "$2")
    shift
    ;;
  *)
    echo "install-apk: unknown argument $1" >&2
    exit 2
    ;;
  esac
  shift
done

# A named file is verified against the record written beside it, with the
# debug variant's defaults for the identity and Rust selection.
case "$VARIANT" in
*.apk)
  APK=$VARIANT
  VARIANT=debug
  HINT="check the path"
  ;;
*)
  APK="android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
  HINT="build one with npm run android:debug or npm run android:prod"
  ;;
esac
if [ ! -f "$APK" ]; then
  echo "install-apk: no APK at $APK" >&2
  echo "install-apk: $HINT" >&2
  exit 1
fi

echo "install-apk: $APK"

# A stub bundle is judged on its own contents, whatever its record says.
node scripts/lint-android-bundle.mjs --apk "$APK" || exit 1

# The handset's ABIs, when one answers, so a build carrying no library it can
# load is refused before the install rather than crashing at launch.
ABIS=$(adb shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r' || true)
if [ -n "$ABIS" ]; then
  EXPECT+=(--device-abis "$ABIS")
fi

# Read from the file rather than off the device, so a refusal costs no install
# and the phone is never left holding the build being rejected.
if ! node scripts/build-record.js verify "$VARIANT" --apk "$APK" ${EXPECT[@]+"${EXPECT[@]}"}; then
  if [ "$ALLOW_STALE" -eq 0 ]; then
    echo "install-apk: refusing, this APK is not the build of the tree you are on" >&2
    echo "install-apk: rebuild it with npm run android:debug, or pass --stale to install it anyway" >&2
    exit 1
  fi
  echo "install-apk: installing an unverified build because --stale was passed" >&2
fi

# -r keeps the library: an uninstall wipes routes.db, which is what most
# measurements on this handset need.
exec adb install -r "$APK"
