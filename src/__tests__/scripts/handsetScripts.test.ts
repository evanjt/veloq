/**
 * The scripts that drive a handset, run against a fake `adb` and a fake
 * `maestro` that log what they were asked to do, so nothing reaches a phone.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');

const S22 = '192.168.1.118:5555';
const ONEPLUS = '10.0.0.3:5555';
const EMULATOR = 'emulator-5554';

type Run = { status: number | null; stdout: string; stderr: string; dir: string };

/**
 * A directory holding `adb` and `maestro` stand-ins and a no-op `sleep`.
 *
 * `adb` answers `devices` with `attached`, and the rest from files the test
 * writes into the directory: `focus` for `dumpsys window`, `installed` for the
 * package `am start` can resolve, `phase` for the counts `sqlite3` reports. Every
 * call is logged to `adb.log`, and the serial the device lock was taken for
 * beside it in `locked.log`. `maestro` logs its arguments to `maestro.log`,
 * and for a flow it also logs the `appId` the flow resolves to, with the `-e`
 * values substituted the way Maestro substitutes them.
 */
function fakes(attached: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-handset-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const listing = ['List of devices attached', ...attached.map((s) => `${s}\tdevice`)].join('\\n');
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/adb.log"
echo "\${VELOQ_DEVICE_SERIAL:-}" >> "${dir}/locked.log"
args=("$@")
[ "\${args[0]}" = "-s" ] && args=("\${args[@]:2}")
case "\${args[*]}" in
  devices*) printf '${listing}\\n' ;;
  "shell dumpsys window"*) cat "${dir}/focus" 2>/dev/null ;;
  "shell am start"*)
    last="\${args[\${#args[@]}-1]}"
    if [ "$last" != "$(cat "${dir}/installed" 2>/dev/null)" ]; then
      echo "Error: Activity not started, unable to resolve Intent { pkg=$last }"
    else
      echo "Starting: Intent { pkg=$last }"
    fi ;;
  "install -r"*) echo after > "${dir}/phase"; echo Success ;;
  shell\\ sqlite3*)
    if [ "$(cat "${dir}/phase" 2>/dev/null)" = after ]; then v=30; else v=12; fi
    printf 'user_version=%s\\nactivities=5\\nsections=3\\njunction=4\\nroutes=2\\n' "$v" ;;
  "shell ls"*) echo 0 ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, 'maestro'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/maestro.log"
envs=()
flow=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-e" ] && envs+=("$arg")
  case "$arg" in *.yaml) flow="$arg" ;; esac
  prev="$arg"
done
if [ -n "$flow" ]; then
  app=$(sed -n 's/^appId: *//p' "$flow" | head -1)
  for kv in "\${envs[@]}"; do app="\${app//\\$\\{\${kv%%=*}\\}/\${kv#*=}}"; done
  echo "$app" >> "${dir}/appids.log"
fi
[ "$*" != "\${*%hierarchy}" ] && echo '<hierarchy text="veloq"/>'
exit 0
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

function run(dir: string, script: string, args: string[], env: Record<string, string>): Run {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
    HOME: dir,
    TMPDIR: dir,
    VELOQ_DEVICE_LOCK: path.join(dir, 'device.lock'),
    VELOQ_DEVICE_LOCK_HELD: '',
  };
  delete base.ANDROID_SERIAL;
  delete base.DEVICE;
  delete base.VELOQ_DEVICE_SERIAL;
  const result = spawnSync('bash', [path.join(REPO, script), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...base, ...env },
    timeout: 60000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, dir };
}

const lines = (dir: string, file: string): string[] => {
  const full = path.join(dir, file);
  return fs.existsSync(full)
    ? fs.readFileSync(full, 'utf8').trim().split('\n').filter(Boolean)
    : [];
};

/**
 * Scenario: the local upgrade run installs the dev build, `APP_ID` naming
 * `com.veloq.app.dev`, while a second handset is attached.
 *
 * Expected behaviour: both flows launch the application the script installed
 * and counted, and Maestro runs on the locked handset rather than whichever
 * transport it enumerates first. The flows used to name the release id and
 * Maestro ran bare, so the seed ran on another app, or another phone.
 */
describe('upgrade-test.sh', () => {
  function upgrade(appId: string) {
    const dir = fakes([ONEPLUS, S22]);
    const sdk = path.join(dir, 'sdk/platform-tools');
    fs.mkdirSync(sdk, { recursive: true });
    fs.copyFileSync(path.join(dir, 'bin/adb'), path.join(sdk, 'adb'));
    fs.chmodSync(path.join(sdk, 'adb'), 0o755);
    return run(dir, 'scripts/upgrade-test.sh', [], {
      ANDROID_SERIAL: S22,
      ANDROID_HOME: path.join(dir, 'sdk'),
      APP_ID: appId,
      FROM_APK: path.join(dir, 'old.apk'),
      NEW_APK: path.join(dir, 'new.apk'),
      WORK: path.join(dir, 'work'),
    });
  }

  it.each(['com.veloq.app.dev', 'com.veloq.app'])(
    'launches %s in both flows, the app it installed and counted',
    (appId) => {
      const result = upgrade(appId);

      expect(result.status).toBe(0);
      expect(lines(result.dir, 'appids.log')).toEqual([appId, appId]);
    }
  );

  it('runs both flows on the locked handset', () => {
    const result = upgrade('com.veloq.app.dev');

    const calls = lines(result.dir, 'maestro.log');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain(`--device ${S22}`);
      expect(call).not.toContain(ONEPLUS);
    }
  });
});

/**
 * Scenario: `ANDROID_SERIAL` names the emulator, as the device lock asks, and
 * the jank rig is run with `DEVICE` unset, or set to another phone.
 *
 * Expected behaviour: the rig drives the handset the lock was taken on. It used
 * to drive `DEVICE`, which defaulted to the S22, so it installed, relaunched and
 * reset `gfxinfo` on a phone it held no lock for.
 */
describe('measure-feed-jank.sh', () => {
  function jank(env: Record<string, string>) {
    const dir = fakes([S22, EMULATOR]);
    const staging = path.join(dir, 'staging/assets');
    fs.mkdirSync(staging, { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'src/i18n/locales/en-AU.json'),
      path.join(staging, 'index.android.bundle')
    );
    fs.writeFileSync(
      path.join(staging, 'app.config'),
      JSON.stringify({ extra: { buildCommit: 'deadbee' } })
    );
    spawnSync('zip', ['-q', '-r', path.join(dir, 'build.apk'), 'assets'], {
      cwd: path.join(dir, 'staging'),
    });
    return run(dir, 'scripts/measure-feed-jank.sh', ['after', 'build.apk', '1'], env);
  }

  const targets = (dir: string) =>
    lines(dir, 'adb.log')
      .filter((call) => call.startsWith('-s '))
      .map((call) => call.split(' ')[1]);

  it('drives the handset ANDROID_SERIAL names', () => {
    const result = jank({ ANDROID_SERIAL: EMULATOR });

    expect(targets(result.dir).length).toBeGreaterThan(0);
    expect(new Set(targets(result.dir))).toEqual(new Set([EMULATOR]));
    for (const call of lines(result.dir, 'maestro.log')) expect(call).toContain(EMULATOR);
  });

  it('takes the lock on DEVICE when that is what names the handset', () => {
    const result = jank({ DEVICE: EMULATOR });

    expect(new Set(targets(result.dir))).toEqual(new Set([EMULATOR]));
    const driving = lines(result.dir, 'adb.log')
      .map((call, i) => [call, lines(result.dir, 'locked.log')[i]] as const)
      .filter(([call]) => call.startsWith('-s '));
    for (const [, locked] of driving) expect(locked).toBe(EMULATOR);
  });

  it('installs the named APK through the stamp check, on the locked handset', () => {
    const result = jank({ ANDROID_SERIAL: EMULATOR });

    expect(result.stderr).toContain('stamped deadbee');
    expect(lines(result.dir, 'adb.log')).toContain(`install -r ${result.dir}/build.apk`);
    const at = lines(result.dir, 'adb.log').indexOf(`install -r ${result.dir}/build.apk`);
    expect(lines(result.dir, 'locked.log')[at]).toBe(EMULATOR);
  });

  it('refuses when DEVICE and ANDROID_SERIAL name different handsets', () => {
    const result = jank({ ANDROID_SERIAL: EMULATOR, DEVICE: S22 });

    expect(result.status).not.toBe(0);
    expect(targets(result.dir)).toEqual([]);
    expect(result.stderr).toContain(EMULATOR);
    expect(result.stderr).toContain(S22);
  });
});

/**
 * Scenario: the hierarchy capture is run while the dev build is the one
 * installed, or while another app has focus.
 *
 * Expected behaviour: it opens the screens in the dev build, refuses an intent
 * Android could not resolve, and writes no snapshot unless Veloq has focus. It
 * used to target the release id with the errors dropped and dump whatever was on
 * screen, on whichever phone Maestro picked.
 */
describe('capture-hierarchy.sh', () => {
  const VELOQ_FOCUS = 'mCurrentFocus=Window{1 u0 com.veloq.app.dev/com.veloq.app.dev.MainActivity}';
  const BROWSER_FOCUS = 'mCurrentFocus=Window{2 u0 com.android.chrome/org.chromium.Main}';

  function capture(installed: string, focus: string) {
    const dir = fakes([ONEPLUS, S22]);
    fs.writeFileSync(path.join(dir, 'installed'), installed);
    fs.writeFileSync(path.join(dir, 'focus'), `${focus}\n`);
    return run(dir, 'scripts/capture-hierarchy.sh', ['android'], { ANDROID_SERIAL: S22 });
  }

  const written = (dir: string) => {
    const snapshots = path.join(dir, '.maestro/snapshots');
    return fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : [];
  };

  it('captures the dev build when it has focus, on the locked handset', () => {
    const result = capture('com.veloq.app.dev', VELOQ_FOCUS);

    expect(result.status).toBe(0);
    expect(written(result.dir)).toContain('home.json');
    const starts = lines(result.dir, 'adb.log').filter((c) => c.includes('am start'));
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) expect(start).toMatch(/ com\.veloq\.app\.dev$/);
    const dumps = lines(result.dir, 'maestro.log');
    expect(dumps.length).toBeGreaterThan(0);
    for (const dump of dumps) expect(dump).toContain(`--device ${S22}`);
  });

  it('writes nothing when another app has focus', () => {
    const result = capture('com.veloq.app.dev', BROWSER_FOCUS);

    expect(result.status).not.toBe(0);
    expect(written(result.dir)).toEqual([]);
    expect(lines(result.dir, 'maestro.log')).toEqual([]);
  });

  it('refuses an intent Android could not resolve', () => {
    const result = capture('com.veloq.app', VELOQ_FOCUS);

    expect(result.status).not.toBe(0);
    expect(written(result.dir)).toEqual([]);
    expect(result.stderr).toContain('Error');
  });
});

/**
 * Scenario: the v12 fixture is captured from the released 0.3.x binary, which
 * installs as `com.veloq.app`, and the pull reads that package's files.
 *
 * Expected behaviour: the seed flow launches the release id. It must not drift
 * to the dev id or lose the id, or the fixture is captured from the wrong app.
 */
describe('capture-v12-fixture.sh', () => {
  function capture() {
    const dir = fakes([EMULATOR]);
    const repo = path.join(dir, 'repo');
    fs.mkdirSync(path.join(repo, 'modules/veloqrs/rust/veloqrs/tests/fixtures'), {
      recursive: true,
    });
    fs.symlinkSync(path.join(REPO, 'scripts'), path.join(repo, 'scripts'));
    fs.symlinkSync(path.join(REPO, '.maestro'), path.join(repo, '.maestro'));
    const avd = path.join(dir, '.android/avd/v12_fixture.avd');
    fs.mkdirSync(avd, { recursive: true });
    fs.writeFileSync(path.join(avd, 'config.ini'), 'tag.id = google_apis\n');
    const work = path.join(dir, 'work');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'veloq-0.3.8.apk'), '');
    const sdk = path.join(dir, 'sdk/platform-tools');
    fs.mkdirSync(sdk, { recursive: true });
    fs.copyFileSync(path.join(dir, 'bin/adb'), path.join(sdk, 'adb'));
    fs.chmodSync(path.join(sdk, 'adb'), 0o755);
    fs.writeFileSync(
      path.join(dir, 'bin/sqlite3'),
      `#!/usr/bin/env bash
case "$*" in
  *user_version*) echo 12 ;;
  *COUNT*) echo 0 ;;
esac
exit 0
`,
      { mode: 0o755 }
    );
    return run(dir, path.relative(REPO, path.join(repo, 'scripts/capture-v12-fixture.sh')), [], {
      ANDROID_SERIAL: EMULATOR,
      ANDROID_HOME: path.join(dir, 'sdk'),
      WORK: work,
    });
  }

  it('launches the seed flow as the release application id', () => {
    const result = capture();

    expect(result.status).toBe(0);
    expect(lines(result.dir, 'appids.log')).toEqual(['com.veloq.app']);
  });
});
