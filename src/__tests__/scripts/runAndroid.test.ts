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
  '#!/bin/sh\n[ "$VELOQ_ANDROID_BUILD_LOCK_HELD" = 1 ] || exit 42\n[ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ] || exit 43\necho "gradlew $* APP_VARIANT=${APP_VARIANT:-}" >> "$TEST_LOG"\necho "gradlew rust profile ${VELOQRS_RUST_PROFILE:-unset}" >> "$TEST_LOG"\n[ "${TEST_FAIL_BUILD:-}" != 1 ]\n';

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
  /** What the handset answers for its primary ABI, empty for no answer. */
  abi?: string;
  /** The package the generated project builds, or null for no project at all. */
  tree?: string | null;
  /** The Rust profile the caller exported, if any. */
  rustProfile?: string;
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
    'android-device-abi.sh',
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
      // The ABI query is read-only and answered before any lock is taken.
      'if [ "$*" = "shell getprop ro.product.cpu.abi" ]; then echo "adb $* serial=$ANDROID_SERIAL" >> "$TEST_LOG"; [ -z "${VELOQ_ANDROID_BUILD_LOCK_HELD:-}" ] || exit 45; printf "%s\\r\\n" "${TEST_ABI:-}"; exit 0; fi\n' +
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
  {
    serial = 'emulator-5554',
    failBuild = false,
    abi = 'arm64-v8a',
    rustProfile,
  }: Omit<Options, 'tree'> = {}
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VELOQRS_RUST_PROFILE;
  if (rustProfile !== undefined) env.VELOQRS_RUST_PROFILE = rustProfile;
  // No allowlist from the machine running the suite, so only the emulator is a test handset.
  delete env.VELOQ_TEST_HANDSETS;
  delete env.VELOQ_ALLOW_HANDSET;
  const result = spawnSync(path.join(f.dir, 'scripts/run-android.sh'), args, {
    cwd: f.dir,
    encoding: 'utf8',
    env: {
      ...env,
      XDG_CONFIG_HOME: f.dir,
      PATH: `${f.bin}:${process.env.PATH}`,
      ANDROID_SERIAL: serial,
      // The caller's own selection, which the arguments override.
      APP_VARIANT: args[0] === 'production' ? 'dev' : 'production',
      VELOQ_ANDROID_BUILD_LOCK: path.join(f.dir, 'build.lock'),
      VELOQ_DEVICE_LOCK: path.join(f.dir, 'device.lock'),
      TEST_LOG: f.log,
      TEST_NO_DEVICE: serial ? '0' : '1',
      TEST_FAIL_BUILD: failBuild ? '1' : '0',
      TEST_ABI: abi,
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
const rustProfiles = (calls: string[]) =>
  calls.filter((call) => call.startsWith('gradlew rust profile '));
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

  it('refuses a handset that is not a test handset before building', () => {
    const { result, calls } = run(DEV_METRO, { serial: '192.0.2.40:5555' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('192.0.2.40:5555');
    expect(result.stderr).toContain('VELOQ_ALLOW_HANDSET');
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
    expect(assembles(calls)).toEqual([
      'gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a APP_VARIANT=dev',
    ]);
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
    expect(assembles(calls)).toEqual([
      'gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a ' +
        '-Pandroid.enableMinifyInReleaseBuilds=false ' +
        '-Pandroid.enableShrinkResourcesInReleaseBuilds=false ' +
        '-Pandroid.enablePngCrunchInReleaseBuilds=false APP_VARIANT=dev',
    ]);
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
      expect(assembles(calls)).toEqual([
        'gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a APP_VARIANT=production',
      ]);
      expect(assembles(calls)[0]).not.toContain('InReleaseBuilds');
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

describe('Android device builds compile for the handset ABI only', () => {
  it.each([[DEV_METRO], [DEV_STANDALONE], [PRODUCTION]])(
    'builds %j for the ABI the pinned handset reports',
    (args) => {
      const { result, calls } = run(args, { abi: 'x86_64' });
      expect(result.status).toBe(0);
      expect(calls).toContain('adb shell getprop ro.product.cpu.abi serial=emulator-5554');
      expect(at(calls, 'adb shell getprop')).toBeLessThan(at(calls, 'gradlew assemble'));
      expect(assembles(calls)).toHaveLength(1);
      expect(assembles(calls)[0]).toContain(' -PreactNativeArchitectures=x86_64 ');
    }
  );

  it.each([[''], ['mips'], ['arm64-v8a,x86']])(
    'builds arm64-v8a when the handset answers %j',
    (abi) => {
      const { result, calls } = run(DEV_METRO, { abi });
      expect(result.status).toBe(0);
      expect(assembles(calls)[0]).toContain(' -PreactNativeArchitectures=arm64-v8a ');
    }
  );
});

describe('The Rust profile each Android build compiles the engine with', () => {
  it('builds the engine for a Metro build with the local profile', () => {
    const { result, calls } = run(DEV_METRO);
    expect(result.status).toBe(0);
    expect(rustProfiles(calls)).toEqual(['gradlew rust profile release-dev']);
  });

  it('keeps the profile a caller exported for a Metro build', () => {
    const { result, calls } = run(DEV_METRO, { rustProfile: 'release' });
    expect(result.status).toBe(0);
    expect(rustProfiles(calls)).toEqual(['gradlew rust profile release']);
  });

  it.each([[DEV_STANDALONE], [PRODUCTION]])('selects no local profile for %j', (args) => {
    const { result, calls } = run(args, {
      tree: args[0] === 'production' ? 'com.veloq.app' : 'com.veloq.app.dev',
    });
    expect(result.status).toBe(0);
    expect(rustProfiles(calls)).toEqual(['gradlew rust profile unset']);
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

describe('The debug recipe compiles for the handset ABI only', () => {
  const recipe = (
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts['android:debug'];

  /** Run the recipe with spies for every tool and return the Gradle calls it made. */
  function debugBuild({ serial, abi }: { serial: string; abi: string }) {
    const f = fixture('com.veloq.app.dev');
    try {
      executable(path.join(f.bin, 'node'), '#!/bin/sh\necho "node $*" >> "$TEST_LOG"\n');
      executable(
        path.join(f.bin, 'adb'),
        '#!/bin/sh\n' +
          'if [ "$1" = devices ]; then printf "List of devices attached\\n"; [ -z "$TEST_DEVICE" ] || printf "%s\\tdevice\\n" "$TEST_DEVICE"; exit 0; fi\n' +
          '[ "$*" = "shell getprop ro.product.cpu.abi" ] || exit 44\n' +
          '[ "$ANDROID_SERIAL" = "$TEST_DEVICE" ] || exit 1\n' +
          'printf "%s\\r\\n" "$TEST_ABI"\n'
      );
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.ANDROID_SERIAL;
      delete env.VELOQ_TEST_HANDSETS;
      delete env.VELOQ_ALLOW_HANDSET;
      const result = spawnSync('sh', ['-c', recipe], {
        cwd: f.dir,
        encoding: 'utf8',
        env: {
          ...env,
          XDG_CONFIG_HOME: f.dir,
          PATH: `${f.bin}:${process.env.PATH}`,
          VELOQ_ANDROID_BUILD_LOCK: path.join(f.dir, 'build.lock'),
          TEST_LOG: f.log,
          TEST_DEVICE: serial,
          TEST_ABI: abi,
        },
      });
      const calls = fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').trim().split('\n') : [];
      return { result, gradle: calls.filter((call) => call.startsWith('gradlew assemble')) };
    } finally {
      fs.rmSync(f.dir, { recursive: true, force: true });
    }
  }

  it('builds for the ABI the attached emulator reports', () => {
    const { result, gradle } = debugBuild({ serial: 'emulator-5554', abi: 'x86_64' });
    expect(result.status).toBe(0);
    expect(gradle).toEqual([
      'gradlew assembleDebug -PreactNativeArchitectures=x86_64 APP_VARIANT=dev',
    ]);
  });

  it('builds arm64-v8a when no device answers', () => {
    const { result, gradle } = debugBuild({ serial: '', abi: '' });
    expect(result.status).toBe(0);
    expect(gradle).toEqual([
      'gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a APP_VARIANT=dev',
    ]);
  });

  it('asks nothing of a handset that is not a test handset and builds arm64-v8a', () => {
    const { result, gradle } = debugBuild({ serial: '192.0.2.40:5555', abi: 'x86' });
    expect(result.status).toBe(0);
    expect(gradle).toEqual([
      'gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a APP_VARIANT=dev',
    ]);
  });
});
