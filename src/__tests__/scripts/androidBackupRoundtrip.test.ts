/**
 * Scenario: the release check of Android Auto Backup backs the app up, drops
 * the record zip and restores it, on a handset holding a real library.
 *
 * Expected behaviour: `android-backup-roundtrip.sh` deletes the zip only once
 * the backup agent has recorded a new backup, never uninstalls or clears the
 * app, puts the zip back when the restore does not, and ends on one PASS or
 * FAIL line naming the step. Driven against a fake `adb` that keeps the
 * handset's state in files, so nothing reaches a phone.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/android-backup-roundtrip.sh');

const HANDSET = 'bench-handset-01';
const ZIP = 'PK\u0003\u0004 a record zip with settings and decisions';

type Handset = {
  enabled?: boolean;
  transport?: 'google' | 'local';
  debuggable?: boolean;
  zip?: string | null;
  backup?: 'recorded' | 'unmoved' | 'quota';
  restore?: 'recorded' | 'nothing' | 'altered' | 'unrecorded';
  token?: string;
  model?: string;
  /** `ro.kernel.qemu`, `1` on an emulator and empty on a phone. */
  qemu?: string;
  /** Paths under the app's data the transport carries although the rules exclude them. */
  leaks?: string[];
  /** Whether the install itself restores, as Android does with automatic restore on. */
  installRestore?: boolean;
  /** Whether `cmd package unstop` exists, as it does from Android 14. */
  unstop?: boolean;
};

const PREFS = '<map><string name="units">metric</string></map>';
const TRANSPORTS = {
  google: 'com.google.android.gms/.backup.BackupTransportService',
  local: 'com.android.localtransport/.LocalTransport',
};

/**
 * A directory holding the fake `adb` and a no-op `sleep`. The app's data is the
 * tree under `data/`, the backed-up set `cloud/`, and each key of the agent's
 * record a file under `record/`, rendered as the agent's preferences XML when
 * read. The selected transport is in `transport`. Every call is logged to
 * `adb.log`.
 */
function handset(options: Handset = {}): string {
  const {
    enabled = true,
    transport = 'google',
    debuggable = true,
    zip = ZIP,
    backup = 'recorded',
    restore = 'recorded',
    token = '3a5e7b8c1d2f4e6a',
    model = 'Bench Phone',
    qemu = '',
    leaks = [],
    installRestore = false,
    unstop = true,
  } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-roundtrip-'));
  const bin = path.join(dir, 'bin');
  const data = path.join(dir, 'data');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'record'));
  fs.mkdirSync(path.join(data, 'files/backups'), { recursive: true });
  fs.mkdirSync(path.join(data, 'shared_prefs'));
  if (zip !== null) fs.writeFileSync(path.join(data, 'files/veloq-decisions.zip'), zip);
  fs.writeFileSync(path.join(data, 'files/routes.db'), 'SQLite format 3 a library');
  fs.writeFileSync(path.join(data, 'files/backups/veloq-old.zip'), 'a legacy backup');
  fs.writeFileSync(path.join(data, 'shared_prefs/bench_settings.xml'), PREFS);
  fs.writeFileSync(path.join(data, 'shared_prefs/SecureStore.xml'), '<map>a token</map>');
  fs.writeFileSync(path.join(dir, 'record/backedUpAt'), '1700000000000');
  fs.writeFileSync(path.join(dir, 'record/backedUpBytes'), '41000');
  fs.writeFileSync(path.join(dir, 'transport'), TRANSPORTS[transport]);
  fs.writeFileSync(path.join(dir, 'enabled'), enabled ? 'enabled' : 'disabled');

  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/adb.log"
args=("$@")
[ "\${args[0]}" = "-s" ] && args=("\${args[@]:2}")
call="\${args[*]}"
data="${data}"
record() {
  mkdir -p "${dir}/record"; echo "$2" > "${dir}/record/$1"
  # The agent keeps its record in the app's own preferences, as on a handset.
  [ -d "$data/shared_prefs" ] && touch "$data/shared_prefs/veloq_auto_backup.xml"
}
restore() {
  [ -d "${dir}/cloud" ] && cp -r "${dir}/cloud/." "$data/"
  case "${restore}" in
    recorded) record restoredAt 1760000060000 ;;
    unrecorded) ;;
    altered) echo "something else" > "$data/files/veloq-decisions.zip"; record restoredAt 1760000060000 ;;
  esac
}
case "$call" in
  *"run-as com.veloq.app.dev"*)
    if [ "${debuggable}" != true ]; then
      echo "run-as: package not debuggable: com.veloq.app.dev" >&2; exit 1
    fi ;;
esac
case "$call" in
  "shell getprop ro.product.model") echo "${model}" ;;
  "shell getprop ro.kernel.qemu") echo "${qemu}" ;;
  "shell bmgr enabled") echo "Backup Manager currently $(cat "${dir}/enabled")" ;;
  "shell bmgr enable true") echo enabled > "${dir}/enabled"; echo "Backup Manager now enabled" ;;
  "shell bmgr enable false") echo disabled > "${dir}/enabled"; echo "Backup Manager now disabled" ;;
  "shell bmgr list transports")
    for t in com.google.android.gms/.backup.migrate.service.D2dTransport ${TRANSPORTS.google} ${TRANSPORTS.local}; do
      if [ "$t" = "$(cat "${dir}/transport")" ]; then echo "  * $t"; else echo "    $t"; fi
    done ;;
  "shell bmgr transport "*)
    echo "Selected transport \${args[3]} (formerly $(cat "${dir}/transport"))"
    echo "\${args[3]}" > "${dir}/transport" ;;
  "shell am force-stop com.veloq.app.dev") touch "${dir}/stopped" ;;
  "shell cmd package unstop com.veloq.app.dev")
    if [ "${unstop}" = true ]; then rm -f "${dir}/stopped"
    else echo "Unknown command: unstop"; exit 255; fi ;;
  "shell run-as com.veloq.app.dev ls -d "*)
    target="\${args[5]}"
    if [ -e "$data/$target" ]; then echo "$target"
    else echo "ls: $target: No such file or directory"; fi ;;
  "shell run-as com.veloq.app.dev ls "*)
    target="\${args[4]}"
    if [ -d "$data/$target" ]; then ls "$data/$target"
    elif [ -e "$data/$target" ]; then echo "$target"
    else echo "ls: $target: No such file or directory"; fi ;;
  "exec-out run-as com.veloq.app.dev cat shared_prefs/veloq_auto_backup.xml")
    echo "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>"
    echo "<map>"
    for f in "${dir}"/record/*; do
      [ -f "$f" ] && echo "    <long name=\\"$(basename "$f")\\" value=\\"$(cat "$f")\\" />"
    done
    echo "</map>" ;;
  "exec-out run-as com.veloq.app.dev cat "*) cat "$data/\${args[4]}" ;;
  "shell bmgr backupnow com.veloq.app.dev")
    echo "Running incremental backup for 1 requested packages."
    if [ -e "${dir}/stopped" ]; then
      echo "Package com.veloq.app.dev with result: Backup is not allowed"
      echo "Backup finished with result: Success"
      exit 0
    fi
    case "${backup}" in
      recorded)
        rm -rf "${dir}/cloud"; mkdir -p "${dir}/cloud/files" "${dir}/cloud/shared_prefs"
        cp "$data/files/veloq-decisions.zip" "${dir}/cloud/files/"
        for leak in ${leaks.join(' ')}; do cp -r "$data/$leak" "${dir}/cloud/$leak"; done
        record backedUpAt 1760000000000; record backedUpBytes 52000
        echo "Package com.veloq.app.dev with result: Success" ;;
      quota)
        record quotaExceededAt 1760000000000; record quotaExceededBytes 30000000
        record quotaBytes 26214400
        echo "Package com.veloq.app.dev with result: Quota exceeded" ;;
      unmoved) echo "Package com.veloq.app.dev with result: Success" ;;
    esac
    echo "Backup finished with result: Success" ;;
  "shell run-as com.veloq.app.dev rm files/veloq-decisions.zip") rm -f "$data/files/veloq-decisions.zip" ;;
  "shell dumpsys backup")
    echo "Backup Manager is enabled / provisioned / not pending init"
    echo "Ancestral: 0"
    echo "Current:   ${token}" ;;
  "shell bmgr restore ${token} com.veloq.app.dev")
    [ "${restore}" = nothing ] || restore
    echo "restoreFinished: 0"
    echo "done" ;;
  "exec-in run-as com.veloq.app.dev sh -c 'cat > files/veloq-decisions.zip'") cat > "$data/files/veloq-decisions.zip" ;;
  "uninstall com.veloq.app.dev") rm -rf "$data" "${dir}/record"; echo "Success" ;;
  "install "*)
    [ -f "\${args[1]}" ] || { echo "adb: \${args[1]} not found"; exit 1; }
    mkdir -p "$data/files" "$data/shared_prefs"
    touch "${dir}/stopped"
    if [ "${installRestore}" = true ] && [ "${restore}" != nothing ]; then restore; fi
    echo "Performing Streamed Install"; echo "Success" ;;
  *) echo "fake adb: unexpected call: $call" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

function run(
  dir: string,
  env: Record<string, string> = { ANDROID_SERIAL: HANDSET },
  args: string[] = []
) {
  const inherited = { ...process.env };
  delete inherited.ANDROID_SERIAL;
  const result = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: {
      ...inherited,
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
      // The handset lock is the caller's, as under `device-lock-shell.sh`.
      VELOQ_DEVICE_LOCK_HELD: '1',
      ...env,
    },
  });
  const log = path.join(dir, 'adb.log');
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  const read = (relative: string) => {
    const file = path.join(dir, 'data', relative);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };
  return {
    status: result.status,
    verdict: result.stdout.trim(),
    stderr: result.stderr,
    calls,
    zip: read('files/veloq-decisions.zip'),
    read,
    transport: fs.readFileSync(path.join(dir, 'transport'), 'utf8').trim(),
  };
}

const deleted = (calls: string[]) => calls.some((c) => c.includes(' rm '));
const restored = (calls: string[]) => calls.some((c) => c.includes('bmgr restore'));

describe('android-backup-roundtrip.sh', () => {
  const dirs: string[] = [];
  const fixture = (options?: Handset) => {
    const dir = handset(options);
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes when the zip comes back byte-identical and the agent records the restore', () => {
    const result = run(fixture());

    expect(result.status).toBe(0);
    expect(result.verdict).toMatch(/^PASS: /);
    expect(result.verdict.split('\n')).toHaveLength(1);
    expect(result.verdict).toContain('52000 bytes of the 25 MB cap');
    expect(result.verdict).toContain('restored 2025-10-09T08:54:20Z');
    expect(result.calls).toContain('shell bmgr restore 3a5e7b8c1d2f4e6a com.veloq.app.dev');
    expect(result.zip).toBe(ZIP);
  });

  it('clears the stopped state its own force-stop leaves before asking for a backup', () => {
    const { calls } = run(fixture());

    const stop = calls.indexOf('shell am force-stop com.veloq.app.dev');
    const unstop = calls.indexOf('shell cmd package unstop com.veloq.app.dev');
    const backup = calls.indexOf('shell bmgr backupnow com.veloq.app.dev');
    expect(stop).toBeGreaterThanOrEqual(0);
    expect(unstop).toBeGreaterThan(stop);
    expect(backup).toBeGreaterThan(unstop);
  });

  it('fails step 3 naming the stopped package when Android will not back it up, and keeps the zip', () => {
    const result = run(fixture({ unstop: false }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 3: /);
    expect(result.verdict).toContain('not allowed');
    expect(deleted(result.calls)).toBe(false);
    expect(restored(result.calls)).toBe(false);
    expect(result.zip).toBe(ZIP);
  });

  it('refuses a handset with no record zip, and deletes and restores nothing', () => {
    const result = run(fixture({ zip: null }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 2: /);
    expect(result.verdict).toContain('automatic backup');
    expect(result.calls.some((c) => c.includes('backupnow'))).toBe(false);
    expect(deleted(result.calls)).toBe(false);
  });

  it('keeps the zip when the agent stamp does not move after the backup', () => {
    const result = run(fixture({ backup: 'unmoved' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 3: /);
    expect(result.verdict).toContain('did not record');
    expect(deleted(result.calls)).toBe(false);
    expect(restored(result.calls)).toBe(false);
    expect(result.zip).toBe(ZIP);
  });

  it('names an over-quota payload with both sizes, and keeps the zip', () => {
    const result = run(fixture({ backup: 'quota' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 3: /);
    expect(result.verdict).toContain('30000000 bytes over the 26214400 byte quota');
    expect(deleted(result.calls)).toBe(false);
  });

  it('puts the zip back and fails step 5 when the restore brings nothing', () => {
    const result = run(fixture({ restore: 'nothing' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 5: /);
    expect(result.verdict).toContain('put back');
    expect(result.zip).toBe(ZIP);
  });

  it('fails step 5 and puts the original back when the restored zip differs', () => {
    const result = run(fixture({ restore: 'altered' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 5: /);
    expect(result.verdict).toContain('not byte-identical');
    expect(result.zip).toBe(ZIP);
  });

  it('fails step 5 when the zip is back but the agent recorded no restore', () => {
    const result = run(fixture({ restore: 'unrecorded' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 5: /);
    expect(result.verdict).toContain('recorded no restore');
    expect(result.zip).toBe(ZIP);
  });

  it('refuses when Backup Manager is off or the transport is not the Google one', () => {
    for (const options of [{ enabled: false }, { transport: 'local' as const }]) {
      const result = run(fixture(options));

      expect(result.status).toBe(1);
      expect(result.verdict).toMatch(/^FAIL step 1: /);
      expect(deleted(result.calls)).toBe(false);
    }
  });

  it('refuses a build run-as cannot read', () => {
    const result = run(fixture({ debuggable: false }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 2: /);
    expect(result.verdict).toContain('debug build');
  });

  it('fails step 4 when the backup set has no token, before deleting anything', () => {
    const result = run(fixture({ token: '0' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 4: /);
    expect(deleted(result.calls)).toBe(false);
  });

  it('refuses without ANDROID_SERIAL, and reaches no handset', () => {
    const dir = fixture();
    const result = run(dir, {});

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('ANDROID_SERIAL');
    expect(result.calls).toEqual([]);
  });

  it('refuses a handset named protected, by serial or by model, and reaches nothing else', () => {
    for (const protectedName of [HANDSET, 'Bench Phone']) {
      const dir = fixture();
      const result = run(dir, {
        ANDROID_SERIAL: HANDSET,
        VELOQ_PROTECTED_HANDSETS: `someone-else,${protectedName}`,
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('protected');
      expect(result.calls.every((c) => c === 'shell getprop ro.product.model')).toBe(true);
    }
  });

  it('never uninstalls or clears the app', () => {
    for (const options of [{}, { restore: 'nothing' as const }, { backup: 'unmoved' as const }]) {
      const { calls } = run(fixture(options));

      expect(calls.some((c) => /uninstall|pm clear/.test(c))).toBe(false);
    }
  });
});

describe('android-backup-roundtrip.sh --reinstall', () => {
  const EMULATOR = 'emulator-5554';
  const dirs: string[] = [];
  const fixture = (options?: Handset) => {
    const dir = handset({ qemu: '1', ...options });
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'app-debug.apk'), 'an apk');
    return dir;
  };
  const reinstall = (dir: string, serial = EMULATOR, env: Record<string, string> = {}) =>
    run(dir, { ANDROID_SERIAL: serial, ...env }, ['--reinstall', path.join(dir, 'app-debug.apk')]);
  const uninstalled = (calls: string[]) => calls.some((c) => c.includes('uninstall'));
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes when the record zip comes back and the library, legacy backups and every preference file do not', () => {
    const result = reinstall(fixture());

    expect(result.status).toBe(0);
    expect(result.verdict).toMatch(/^PASS: /);
    expect(result.verdict.split('\n')).toHaveLength(1);
    expect(result.verdict).toContain('of the 25 MB cap');
    expect(result.verdict).not.toContain('preferences');
    expect(result.calls).toContain('uninstall com.veloq.app.dev');
    expect(result.calls.some((c) => c.startsWith('install '))).toBe(true);
    expect(result.calls).toContain('shell bmgr restore 3a5e7b8c1d2f4e6a com.veloq.app.dev');
    expect(result.zip).toBe(ZIP);
    expect(result.read('shared_prefs/bench_settings.xml')).toBeNull();
    expect(result.read('files/routes.db')).toBeNull();
    expect(result.read('shared_prefs/SecureStore.xml')).toBeNull();
    expect(result.read('shared_prefs/veloq_auto_backup.xml')).not.toBeNull();
    expect(result.stderr).toContain('sign in');
  });

  it('selects LocalTransport for the run and puts the previous transport back', () => {
    const result = reinstall(fixture({ transport: 'google' }));

    expect(result.status).toBe(0);
    expect(result.calls).toContain(`shell bmgr transport ${TRANSPORTS.local}`);
    expect(result.transport).toBe(TRANSPORTS.google);
  });

  it('runs no second restore when the install restored the zip itself', () => {
    const result = reinstall(fixture({ installRestore: true }));

    expect(result.status).toBe(0);
    expect(result.verdict).toMatch(/^PASS: /);
    expect(restored(result.calls)).toBe(false);
  });

  it('refuses anything but an emulator before any uninstall, whatever the protected list says', () => {
    const cases: [string, string][] = [
      [HANDSET, ''],
      [HANDSET, '1'],
      [EMULATOR, ''],
    ];
    for (const [serial, qemu] of cases) {
      const dir = fixture({ qemu });
      const result = reinstall(dir, serial, { VELOQ_PROTECTED_HANDSETS: '' });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('emulator');
      expect(uninstalled(result.calls)).toBe(false);
      expect(result.read('files/routes.db')).not.toBeNull();
    }
  });

  it('refuses an apk that is not there before reaching the device', () => {
    const dir = fixture();
    const result = run(dir, { ANDROID_SERIAL: EMULATOR }, [
      '--reinstall',
      path.join(dir, 'gone.apk'),
    ]);

    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
  });

  it('fails when the restore carries the library, a legacy backup or any preference file', () => {
    for (const leak of [
      'files/routes.db',
      'files/backups',
      'shared_prefs/SecureStore.xml',
      'shared_prefs/bench_settings.xml',
    ]) {
      const result = reinstall(fixture({ leaks: [leak] }));

      expect(result.status).toBe(1);
      expect(result.verdict).toMatch(/^FAIL step 5: /);
      expect(result.verdict).toContain(leak);
    }
  });

  it('fails when the restore brings no zip back', () => {
    const result = reinstall(fixture({ restore: 'nothing' }));

    expect(result.status).toBe(1);
    expect(result.verdict).toMatch(/^FAIL step 5: /);
    expect(result.verdict).toContain('veloq-decisions.zip');
  });

  it('uninstalls nothing without a record zip or a recorded backup, and still puts the transport back', () => {
    for (const options of [{ zip: null }, { backup: 'unmoved' as const }]) {
      const result = reinstall(fixture(options));

      expect(result.status).toBe(1);
      expect(result.verdict).toMatch(/^FAIL step [23]: /);
      expect(uninstalled(result.calls)).toBe(false);
      expect(result.transport).toBe(TRANSPORTS.google);
    }
  });
});
