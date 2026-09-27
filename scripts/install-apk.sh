#!/bin/bash
# Install an APK only when it was built from the commit you are on.
#
# An APK outlives its checkout and says nothing about itself. One cut at 13:14
# on 2026-09-19 was installed at 21:36, eight hours and one merge later, and
# ran without the fix it had been installed to test. The build was green, the
# install was green, and the staleness was diagnosed afterwards from git
# timestamps alone.
#
# The stamp is `extra.buildCommit`, which `app.config.js` computes and
# expo-constants writes into `assets/app.config` on every native build.
#
#   scripts/install-apk.sh debug             # refuses a stamp that is not HEAD
#   scripts/install-apk.sh release --stale    # install it anyway, knowingly
set -eu

# One thing at a time against one handset: an install kills whatever is running
# on it, so a measurement in another session loses its app mid-run.
if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

cd "$(dirname "$0")/.."

VARIANT=${1:-debug}
ALLOW_STALE=0
shift || true
for arg in "$@"; do
  case "$arg" in
  --stale) ALLOW_STALE=1 ;;
  *)
    echo "install-apk: unknown argument $arg" >&2
    exit 2
    ;;
  esac
done

APK="android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk"
if [ ! -f "$APK" ]; then
  echo "install-apk: no APK at $APK" >&2
  echo "install-apk: build one with npm run android:debug" >&2
  exit 1
fi

# Read the stamp out of the file rather than off the device, so a refusal costs
# no install and the phone is never left holding the build being rejected.
APK_STAMP=$(unzip -p "$APK" assets/app.config 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).extra.buildCommit||""))}catch(e){}})')
HEAD_STAMP=$(node -e 'process.stdout.write(require("./scripts/lib/build-stamp.js").buildStamp())')

echo "install-apk: $APK"
echo "install-apk: built from ${APK_STAMP:-an unstamped build}, HEAD is ${HEAD_STAMP:-no checkout}"

if [ "$APK_STAMP" != "$HEAD_STAMP" ] || [ -z "$APK_STAMP" ]; then
  if [ "$ALLOW_STALE" -eq 0 ]; then
    echo "install-apk: refusing, this APK is not the code you are on" >&2
    echo "install-apk: rebuild it, or pass --stale to install it anyway" >&2
    exit 1
  fi
  echo "install-apk: installing a stale build because --stale was passed" >&2
elif [ "${APK_STAMP%+}" != "$APK_STAMP" ]; then
  # Two builds off one dirty tree carry the same stamp, so a match here says
  # the commit was the same and nothing about the edits on top of it.
  echo "install-apk: the stamps match but both trees were dirty, so this proves the commit only" >&2
fi

# -r keeps the library: an uninstall wipes routes.db, which is what most
# measurements on this handset need.
exec adb install -r "$APK"
