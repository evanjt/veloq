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
  '#!/bin/sh\n[ "$VELOQ_ANDROID_BUILD_LOCK_HELD" = 1 ] || exit 42\n[ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ] || exit 43\necho "gradlew $* APP_VARIANT=${APP_VARIANT:-}" >> "$TEST_LOG"\n[ "${TEST_FAIL_BUILD:-}" != 1 ]\n';

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

interface Fixture {
  dir: string;
  bin: string;
  log: string;
}

/** Leave the record a generation writes, so the tree reads as generated from the current configuration. */
function recordGeneration(dir: string, appId: string) {
  const source =
    "import { writeFileSync } from 'node:fs';" +
    "import { RECORD, configurationHash } from './scripts/prepare-native.mjs';" +
    'const [appId] = process.argv.slice(1);' +
    "const record = { appId, configuration: configurationHash('.', 'android') };" +
    'writeFileSync(`android/${RECORD}`, JSON.stringify(record));';
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source, appId], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

function fixture(tree: string | null): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-run-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
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
    const target = path.join(dir, 'scripts', name);
    fs.copyFileSync(path.join(root, 'scripts', name), target);
    fs.chmodSync(target, 0o755);
  }
  if (tree !== null) {
    executable(path.join(dir, 'android/app/build.gradle'), gradle(tree));
    for (const [file, contents] of Object.entries(SIGNING)) {
      fs.writeFileSync(path.join(dir, file), contents);
    }
    recordGeneration(dir, tree);
  }
  executable(
    path.join(dir, 'scripts/install-apk.sh'),
    '#!/bin/sh\n[ "$VELOQ_DEVICE_LOCK_HELD" = 1 ] || exit 41\necho "install-apk $*" >> "$TEST_LOG"\nadb install -r "android/app/build/outputs/apk/$1/app-$1.apk"\n'
  );
  executable(path.join(dir, 'android/gradlew'), GRADLEW);
  executable(path.join(dir, 'gradlew.template'), GRADLEW);
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
      'echo "generated $id" >> "$TEST_LOG"\n' +
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
  return { dir, bin, log: path.join(dir, 'calls') };
}

/** Run the script in `f` and return the calls it made, clearing the log for the next run. */
function invoke(
  f: Fixture,
  args: string[],
  { serial = 'emulator-5554', failBuild = false }: Omit<Options, 'tree'> = {}
) {
  const result = spawnSync(path.join(f.dir, 'scripts/run-android.sh'), args, {
    cwd: f.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH}`,
      ANDROID_SERIAL: serial,
      // The caller's own selection, which the arguments override.
      APP_VARIANT: args[0] === 'production' ? 'dev' : 'production',
      VELOQ_ANDROID_BUILD_LOCK: path.join(f.dir, 'build.lock'),
      VELOQ_DEVICE_LOCK: path.join(f.dir, 'device.lock'),
      TEST_LOG: f.log,
      TEST_NO_DEVICE: serial ? '0' : '1',
      TEST_FAIL_BUILD: failBuild ? '1' : '0',
    },
  });
  const calls = fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').trim().split('\n') : [];
  fs.rmSync(f.log, { force: true });
  const built = fs.existsSync(path.join(f.dir, 'android/app/build.gradle'))
    ? fs.readFileSync(path.join(f.dir, 'android/app/build.gradle'), 'utf8')
    : '';
  return { result, calls, built };
}

function run(args: string[], { tree = 'com.veloq.app.dev', ...options }: Options = {}) {
  const f = fixture(tree);
  const outcome = invoke(f, args, options);
  const kept = Object.fromEntries(
    Object.keys(SIGNING).map((file) => {
      const full = path.join(f.dir, file);
      return [file, fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null];
    })
  );
  fs.rmSync(f.dir, { recursive: true, force: true });
  return { ...outcome, kept };
}

const DEV_METRO = ['dev', 'metro'];
const DEV_STANDALONE = ['dev', 'standalone'];
const PRODUCTION = ['production', 'standalone'];
const assembles = (calls: string[]) => calls.filter((call) => call.startsWith('gradlew assemble'));
const at = (calls: string[], prefix: string) => calls.findIndex((call) => call.startsWith(prefix));

describe('Android build and device locks', () => {
  it.each([[DEV_METRO], [DEV_STANDALONE], [PRODUCTION]])(
    'releases the build lock before the %j install and launch',
    (args) => {
      const { result, calls } = run(args);
      expect(result.status).toBe(0);
      expect(at(calls, 'gradlew assemble')).toBeGreaterThanOrEqual(0);
      expect(at(calls, 'adb install')).toBeGreaterThan(at(calls, 'gradlew assemble'));
      expect(at(calls, 'adb shell am start')).toBeGreaterThan(at(calls, 'adb install'));
    }
  );

  it('refuses an unpinned handset before building', () => {
    const { result, calls } = run(DEV_METRO, { serial: '' });
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  it('does not install an APK when the build fails', () => {
    const { result, calls } = run(DEV_METRO, { failBuild: true });
    expect(result.status).not.toBe(0);
    expect(at(calls, 'gradlew assembleDebug')).toBeGreaterThanOrEqual(0);
    expect(at(calls, 'adb install')).toBe(-1);
  });
});

describe('Android identity and compile mode are separate arguments', () => {
  it('builds Dev against Metro: a debug build, the dev client and the bundler', () => {
    const { result, calls } = run(DEV_METRO);
    expect(result.status).toBe(0);
    expect(assembles(calls)).toEqual(['gradlew assembleDebug APP_VARIANT=dev']);
    expect(calls).toContain('install-apk debug --identity dev');
    expect(calls).toContain('adb reverse tcp:8081 tcp:8081');
    expect(calls.at(-2)).toBe(
      'adb shell am start -n com.veloq.app.dev/.MainActivity -d veloq://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
    );
    expect(calls.at(-1)).toBe('npx expo start --dev-client --localhost');
  });

  it('builds Dev standalone: a release build with embedded JavaScript and no Metro', () => {
    const { result, calls } = run(DEV_STANDALONE);
    expect(result.status).toBe(0);
    expect(assembles(calls)).toEqual(['gradlew assembleRelease APP_VARIANT=dev']);
    expect(calls).toContain('node scripts/build-record.js snapshot android release');
    expect(calls).toContain('node scripts/build-record.js write release');
    expect(calls).toContain('install-apk release --identity dev');
    expect(calls.at(-1)).toBe('adb shell am start -n com.veloq.app.dev/.MainActivity');
    expect(calls.some((call) => call.startsWith('adb reverse'))).toBe(false);
    expect(calls.some((call) => call.includes('expo-development-client'))).toBe(false);
    expect(calls.some((call) => call.startsWith('npx expo start'))).toBe(false);
    expect(calls).not.toContain('npm run bundle:android');
  });

  it('builds production standalone, the only mode it has', () => {
    for (const args of [PRODUCTION, ['production']]) {
      const { result, calls } = run(args, { tree: 'com.veloq.app' });
      expect(result.status).toBe(0);
      expect(assembles(calls)).toEqual(['gradlew assembleRelease APP_VARIANT=production']);
      expect(calls).toContain('install-apk release --identity production');
      expect(calls.at(-1)).toBe('adb shell am start -n com.veloq.app/.MainActivity');
    }
  });

  it.each([[['production', 'metro']], [['dev']], [['debug']], [['release']], [[]]])(
    'refuses %j before building or touching the handset',
    (args) => {
      const { result, calls } = run(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage');
      expect(calls).toEqual([]);
    }
  );

  it('moves between Dev and production on one tree, regenerating each time and keeping the data', () => {
    const f = fixture('com.veloq.app');
    try {
      const sequence = [
        [DEV_METRO, 'com.veloq.app.dev', 'debug', 'dev'],
        [PRODUCTION, 'com.veloq.app', 'release', 'production'],
        [DEV_STANDALONE, 'com.veloq.app.dev', 'release', 'dev'],
      ] as const;
      for (const [args, appId, variant, identity] of sequence) {
        const { result, calls, built } = invoke(f, [...args]);
        expect(result.status).toBe(0);
        expect(at(calls, `generated ${appId}`)).toBeGreaterThanOrEqual(0);
        expect(at(calls, `generated ${appId}`)).toBeLessThan(at(calls, 'gradlew assemble'));
        expect(built).toContain(`applicationId '${appId}'`);
        expect(calls).toContain(`install-apk ${variant} --identity ${identity}`);
        expect(calls).toContain(
          `adb install -r android/app/build/outputs/apk/${variant}/app-${variant}.apk`
        );
        expect(calls.filter((call) => /adb (uninstall|shell pm clear)/.test(call))).toEqual([]);
        expect(at(calls, `adb shell am start -n ${appId}/.MainActivity`)).toBeGreaterThanOrEqual(0);
      }
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  });
});

describe('Android builds carry the identity they were asked for', () => {
  const prebuild = 'npx expo prebuild --platform android --clean --no-install';

  it.each([
    [PRODUCTION, 'com.veloq.app.dev', 'gradlew assembleRelease', "applicationId 'com.veloq.app'"],
    [DEV_METRO, 'com.veloq.app', 'gradlew assembleDebug', "applicationId 'com.veloq.app.dev'"],
    [
      DEV_STANDALONE,
      'com.veloq.app',
      'gradlew assembleRelease',
      "applicationId 'com.veloq.app.dev'",
    ],
  ] as const)(
    'regenerates the project before %j over a tree that builds %s',
    (args, tree, assemble, identity) => {
      const { result, calls, built } = run([...args], { tree });
      expect(result.status).toBe(0);
      expect(calls).toContain(prebuild);
      expect(calls.indexOf(prebuild)).toBeLessThan(at(calls, assemble));
      expect(built).toContain(identity);
      expect(result.stderr).toContain(`builds ${tree}, regenerating`);
    }
  );

  it('keeps the release signing files across the regeneration', () => {
    const { result, kept } = run(PRODUCTION, { tree: 'com.veloq.app.dev' });
    expect(result.status).toBe(0);
    expect(kept).toEqual(SIGNING);
  });

  it.each([
    [DEV_METRO, 'com.veloq.app.dev'],
    [DEV_STANDALONE, 'com.veloq.app.dev'],
    [PRODUCTION, 'com.veloq.app'],
  ] as const)('builds %j over a tree that already builds %s as it stands', (args, tree) => {
    const { result, calls, kept } = run([...args], { tree });
    expect(result.status).toBe(0);
    expect(calls.some((call) => call.startsWith('npx expo prebuild'))).toBe(false);
    expect(assembles(calls)).toHaveLength(1);
    expect(kept).toEqual(SIGNING);
    expect(result.stderr).not.toContain('prepare-native');
  });

  it('generates a missing project before building', () => {
    const { result, calls, built } = run(DEV_METRO, { tree: null });
    expect(result.status).toBe(0);
    expect(calls.indexOf(prebuild)).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(prebuild)).toBeLessThan(at(calls, 'gradlew assembleDebug'));
    expect(built).toContain("applicationId 'com.veloq.app.dev'");
  });
});
