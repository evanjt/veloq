#!/usr/bin/env sh

set -eu

if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then
  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"
fi

case "${ANDROID_SERIAL:-}" in
  emulator-*) ;;
  *) echo 'Set ANDROID_SERIAL to an emulator serial' >&2; exit 2 ;;
esac

mode=${1:-}
activity_id=${2:-}
athlete_id=${3:-}
expected_title=${4:-}
if [ -z "$expected_title" ]; then
  echo 'Usage: test-debug-push.sh demo|signed-in|off ACTIVITY_ID ATHLETE_ID EXPECTED_TITLE' >&2
  exit 2
fi

if [ "$mode" = demo ]; then
  "$(dirname "$0")/with-maestro.sh" test .maestro/helpers/setup-demo-mode.yaml --no-ansi
elif [ "$mode" != signed-in ] && [ "$mode" != off ]; then
  echo "Unknown mode: $mode" >&2
  exit 2
fi

adb -s "$ANDROID_SERIAL" shell am broadcast \
  -n com.veloq.app.dev/com.veloq.DebugPushReceiver \
  --es activity_id "$activity_id" --es athlete_id "$athlete_id"
adb -s "$ANDROID_SERIAL" shell cmd statusbar expand-notifications

flow=.maestro/helpers/debug-push-tray.yaml
if [ "$mode" = off ]; then
  flow=.maestro/helpers/debug-push-off.yaml
fi
"$(dirname "$0")/with-maestro.sh" test \
  -e PUSH_EXPECTED_TITLE="$expected_title" "$flow" --no-ansi
