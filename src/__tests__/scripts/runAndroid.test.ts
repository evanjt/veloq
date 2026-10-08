import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');

function executable(file: string, source: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

// Stands in for Gradle in the fixture and in every project the generator stub writes.
const GRADLEW =
  '#!/bin/sh\n[ "$VELOQ_ANDROID_BUILD_LOCK_HELD" = 1 ] || exit 42\n[ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ] || exit 43\necho "gradlew $*" >> "$TEST_LOG"\n[ "${TEST_FAIL_BUILD:-}" != 1 ]\n';

function gradle(appId: string) {
  return `android {\n    namespace '${appId}'\n    defaultConfig {\n        applicationId '${appId}'\n    }\n}\n`;
}

const SIGNING = {
  'android/keystore.properties': 'storeFile=release.keystore\n',
  'android/app/release.keystore': 'orchard-key',
};

interface Options {
  serial?: string;
  failBuild?: boolean;
  /** The package the generated project builds, or null for no project at all. */
  tree?: string | null;
}

function run(
  variant: 'debug' | 'release',
  { serial = 'emulator-5554', failBuild = false, tree = 'com.veloq.app.dev' }: Options = {}
) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'android-run-'));
  const bin = path.join(fixture, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(fixture, 'scripts/lib'), { recursive: true });
  for (const name of [
    'run-android.sh',
    'install-and-launch-android.sh',
    'with-android-build-lock.sh',
    'with-device-lock.sh',
    'device-lock-path.sh',
    'device-lock-handset.sh',
    'prepare-native.mjs',
    'lib/app-identity.js',
  ]) {
    const target = path.join(fixture, 'scripts', name);
    fs.copyFileSync(path.join(root, 'scripts', name), target);
    fs.chmodSync(target, 0o755);
  }
  if (tree !== null) {
    executable(path.join(fixture, 'android/app/build.gradle'), gradle(tree));
    for (const [file, contents] of Object.entries(SIGNING)) {
      fs.writeFileSync(path.join(fixture, file), contents);
    }
  }
  executable(
    path.join(fixture, 'scripts/install-apk.sh'),
    '#!/bin/sh\n[ "$VELOQ_DEVICE_LOCK_HELD" = 1 ] || exit 41\nadb install -r "android/app/build/outputs/apk/$1/app-$1.apk"\n'
  );
  executable(path.join(fixture, 'android/gradlew'), GRADLEW);
  executable(path.join(fixture, 'gradlew.template'), GRADLEW);
  // The identity scripts run for real, every other node script is a spy.
  executable(
    path.join(bin, 'node'),
    `#!/bin/sh\ncase "$1" in scripts/prepare-native.mjs|scripts/lib/app-identity.js) exec "${process.execPath}" "$@";; esac\necho "node $*" >> "$TEST_LOG"\n`
  );
  executable(path.join(bin, 'npm'), '#!/bin/sh\necho "npm $*" >> "$TEST_LOG"\n');
  // A generation with --clean replaces android/ whole with the identity the build selects.
  executable(
    path.join(bin, 'npx'),
    '#!/bin/sh\necho "npx $*" >> "$TEST_LOG"\n' +
      '[ "$1 $2" = "expo prebuild" ] || exit 0\n' +
      '[ "$CI" = 1 ] || exit 48\n' +
      'case "$APP_VARIANT" in production) id=com.veloq.app ;; *) id=com.veloq.app.dev ;; esac\n' +
      'rm -rf android && mkdir -p android/app\n' +
      `printf "android {\\n    defaultConfig {\\n        applicationId '%s'\\n    }\\n}\\n" "$id" > android/app/build.gradle\n` +
      'cp gradlew.template android/gradlew\n'
  );
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
  const kept = Object.fromEntries(
    Object.keys(SIGNING).map((file) => {
      const full = path.join(fixture, file);
      return [file, fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null];
    })
  );
  const built = fs.existsSync(path.join(fixture, 'android/app/build.gradle'))
    ? fs.readFileSync(path.join(fixture, 'android/app/build.gradle'), 'utf8')
    : '';
  fs.rmSync(fixture, { recursive: true, force: true });
  return { result, calls, kept, built };
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
    const { result, calls } = run('debug', { serial: '' });
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  it('does not install an APK when the build fails', () => {
    const { result, calls } = run('debug', { failBuild: true });
    expect(result.status).not.toBe(0);
    expect(calls.some((call) => call.startsWith('gradlew assembleDebug'))).toBe(true);
    expect(calls.some((call) => call.startsWith('adb install'))).toBe(false);
  });
});

describe('Android builds carry the identity they were asked for', () => {
  const prebuild = 'npx expo prebuild --platform android --clean --no-install';

  it.each([
    ['release', 'com.veloq.app.dev', 'gradlew assembleRelease', "applicationId 'com.veloq.app'"],
    ['debug', 'com.veloq.app', 'gradlew assembleDebug', "applicationId 'com.veloq.app.dev'"],
  ] as const)(
    'regenerates the project before a %s build over a tree that builds %s',
    (variant, tree, assemble, identity) => {
      const { result, calls, built } = run(variant, { tree });
      expect(result.status).toBe(0);
      expect(calls).toContain(prebuild);
      expect(calls.indexOf(prebuild)).toBeLessThan(calls.indexOf(assemble));
      expect(built).toContain(identity);
      expect(result.stderr).toContain(`builds ${tree}, regenerating`);
    }
  );

  it('keeps the release signing files across the regeneration', () => {
    const { result, kept } = run('release', { tree: 'com.veloq.app.dev' });
    expect(result.status).toBe(0);
    expect(kept).toEqual(SIGNING);
  });

  it.each([
    ['debug', 'com.veloq.app.dev'],
    ['release', 'com.veloq.app'],
  ] as const)('builds a %s over a tree that already builds %s as it stands', (variant, tree) => {
    const { result, calls, kept } = run(variant, { tree });
    expect(result.status).toBe(0);
    expect(calls.some((call) => call.startsWith('npx expo prebuild'))).toBe(false);
    expect(calls.some((call) => call.startsWith('gradlew assemble'))).toBe(true);
    expect(kept).toEqual(SIGNING);
    expect(result.stderr).not.toContain('prepare-native');
  });

  it('generates a missing project before building', () => {
    const { result, calls, built } = run('debug', { tree: null });
    expect(result.status).toBe(0);
    expect(calls.indexOf(prebuild)).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(prebuild)).toBeLessThan(calls.indexOf('gradlew assembleDebug'));
    expect(built).toContain("applicationId 'com.veloq.app.dev'");
  });
});
