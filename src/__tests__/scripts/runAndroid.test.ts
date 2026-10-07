import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

function run(variant: 'debug' | 'release', serial = 'emulator-5554', failBuild = false) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'android-run-'));
  const bin = path.join(fixture, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(fixture, 'scripts'));
  for (const name of [
    'run-android.sh',
    'install-and-launch-android.sh',
    'with-android-build-lock.sh',
    'with-device-lock.sh',
    'device-lock-path.sh',
    'device-lock-handset.sh',
  ]) {
    const target = path.join(fixture, 'scripts', name);
    fs.copyFileSync(path.join(root, 'scripts', name), target);
    fs.chmodSync(target, 0o755);
  }
  executable(
    path.join(fixture, 'scripts/install-apk.sh'),
    '#!/bin/sh\n[ "$VELOQ_DEVICE_LOCK_HELD" = 1 ] || exit 41\nadb install -r "android/app/build/outputs/apk/$1/app-$1.apk"\n'
  );
  executable(
    path.join(fixture, 'android/gradlew'),
    '#!/bin/sh\n[ "$VELOQ_ANDROID_BUILD_LOCK_HELD" = 1 ] || exit 42\n[ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ] || exit 43\necho "gradlew $*" >> "$TEST_LOG"\n[ "${TEST_FAIL_BUILD:-}" != 1 ]\n'
  );
  executable(path.join(bin, 'node'), '#!/bin/sh\necho "node $*" >> "$TEST_LOG"\n');
  executable(path.join(bin, 'npm'), '#!/bin/sh\necho "npm $*" >> "$TEST_LOG"\n');
  executable(path.join(bin, 'npx'), '#!/bin/sh\necho "npx $*" >> "$TEST_LOG"\n');
  executable(
    path.join(bin, 'adb'),
    '#!/bin/sh\n' +
      'if [ "$1" = devices ]; then printf "List of devices attached\\n"; [ "${TEST_NO_DEVICE:-}" = 1 ] || printf "emulator-5554\\tdevice\\n"; exit 0; fi\n' +
      '[ "$ANDROID_SERIAL" = emulator-5554 ] || exit 44\n' +
      '[ -z "${VELOQ_ANDROID_BUILD_LOCK_HELD:-}" ] || exit 45\n' +
      '[ "$VELOQ_DEVICE_LOCK_HELD" = 1 ] || exit 46\n' +
      'flock -n "$VELOQ_ANDROID_BUILD_LOCK" true || exit 47\n' +
      'echo "adb $*" >> "$TEST_LOG"\n'
  );
  const log = path.join(fixture, 'calls');
  const result = spawnSync(path.join(fixture, 'scripts/run-android.sh'), [variant], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ANDROID_SERIAL: serial,
      VELOQ_ANDROID_BUILD_LOCK: path.join(fixture, 'build.lock'),
      VELOQ_DEVICE_LOCK: path.join(fixture, 'device.lock'),
      TEST_LOG: log,
      TEST_NO_DEVICE: serial ? '0' : '1',
      TEST_FAIL_BUILD: failBuild ? '1' : '0',
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  fs.rmSync(fixture, { recursive: true, force: true });
  return { result, calls };
}

describe('Android build and device locks', () => {
  it.each(['debug', 'release'] as const)(
    'releases the build lock before %s install and launch',
    (variant) => {
      const { result, calls } = run(variant);
      expect(result.status).toBe(0);
      expect(calls.findIndex((call) => call.startsWith('gradlew assemble'))).toBeGreaterThanOrEqual(
        0
      );
      expect(calls.findIndex((call) => call.startsWith('adb install'))).toBeGreaterThan(
        calls.findIndex((call) => call.startsWith('gradlew assemble'))
      );
      expect(calls.findIndex((call) => call.startsWith('adb shell am start'))).toBeGreaterThan(
        calls.findIndex((call) => call.startsWith('adb install'))
      );
      if (variant === 'debug') {
        expect(calls).toContain('adb reverse tcp:8081 tcp:8081');
        expect(calls.at(-2)).toContain(
          'expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
        );
        expect(calls.at(-1)).toBe('npx expo start --dev-client --localhost');
      } else {
        expect(calls.at(-1)).toBe('adb shell am start -n com.veloq.app/.MainActivity');
      }
    }
  );

  it('refuses an unpinned handset before building', () => {
    const { result, calls } = run('debug', '');
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  it('does not install an APK when the build fails', () => {
    const { result, calls } = run('debug', 'emulator-5554', true);
    expect(result.status).not.toBe(0);
    expect(calls.some((call) => call.startsWith('gradlew assembleDebug'))).toBe(true);
    expect(calls.some((call) => call.startsWith('adb install'))).toBe(false);
  });
});
