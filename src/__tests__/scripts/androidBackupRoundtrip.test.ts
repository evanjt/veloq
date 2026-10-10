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
};

/**
 * A directory holding the fake `adb` and a no-op `sleep`. The handset's zip is
 * `zip`, the backed-up copy `cloud`, and each key of the agent's record a file
 * under `record/`, rendered as the agent's preferences XML when read. Every
 * call is logged to `adb.log`.
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
  } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-roundtrip-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'record'));
  if (zip !== null) fs.writeFileSync(path.join(dir, 'zip'), zip);
  fs.writeFileSync(path.join(dir, 'record/backedUpAt'), '1700000000000');
  fs.writeFileSync(path.join(dir, 'record/backedUpBytes'), '41000');

  const selected = transport === 'google' ? '  * ' : '    ';
  const other = transport === 'google' ? '    ' : '  * ';
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/adb.log"
args=("$@")
[ "\${args[0]}" = "-s" ] && args=("\${args[@]:2}")
call="\${args[*]}"
record() { echo "$2" > "${dir}/record/$1"; }
case "$call" in
  *"run-as com.veloq.app.dev"*)
    if [ "${debuggable}" != true ]; then
      echo "run-as: package not debuggable: com.veloq.app.dev" >&2; exit 1
    fi ;;
esac
case "$call" in
  "shell getprop ro.product.model") echo "${model}" ;;
  "shell bmgr enabled") echo "Backup Manager currently ${enabled ? 'enabled' : 'disabled'}" ;;
  "shell bmgr list transports")
    echo "    com.google.android.gms/.backup.migrate.service.D2dTransport"
    echo "${selected}com.google.android.gms/.backup.BackupTransportService"
    echo "${other}com.android.localtransport/.LocalTransport" ;;
  "shell am force-stop com.veloq.app.dev") ;;
  "shell run-as com.veloq.app.dev ls files/veloq-decisions.zip")
    if [ -f "${dir}/zip" ]; then echo files/veloq-decisions.zip
    else echo "ls: files/veloq-decisions.zip: No such file or directory"; fi ;;
  "exec-out run-as com.veloq.app.dev cat files/veloq-decisions.zip") cat "${dir}/zip" ;;
  "exec-out run-as com.veloq.app.dev cat shared_prefs/veloq_auto_backup.xml")
    echo "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>"
    echo "<map>"
    for f in "${dir}"/record/*; do
      echo "    <long name=\\"$(basename "$f")\\" value=\\"$(cat "$f")\\" />"
    done
    echo "</map>" ;;
  "shell bmgr backupnow com.veloq.app.dev")
    echo "Running incremental backup for 1 requested packages."
    case "${backup}" in
      recorded)
        cp "${dir}/zip" "${dir}/cloud"
        record backedUpAt 1760000000000; record backedUpBytes 52000
        echo "Package com.veloq.app.dev with result: Success" ;;
      quota)
        record quotaExceededAt 1760000000000; record quotaExceededBytes 30000000
        record quotaBytes 26214400
        echo "Package com.veloq.app.dev with result: Quota exceeded" ;;
      unmoved) echo "Package com.veloq.app.dev with result: Success" ;;
    esac
    echo "Backup finished with result: Success" ;;
  "shell run-as com.veloq.app.dev rm files/veloq-decisions.zip") rm -f "${dir}/zip" ;;
  "shell dumpsys backup")
    echo "Backup Manager is enabled / provisioned / not pending init"
    echo "Ancestral: 0"
    echo "Current:   ${token}" ;;
  "shell bmgr restore ${token} com.veloq.app.dev")
    case "${restore}" in
      recorded) cp "${dir}/cloud" "${dir}/zip"; record restoredAt 1760000060000 ;;
      unrecorded) cp "${dir}/cloud" "${dir}/zip" ;;
      altered) echo "something else" > "${dir}/zip"; record restoredAt 1760000060000 ;;
      nothing) ;;
    esac
    echo "restoreFinished: 0"
    echo "done" ;;
  "exec-in run-as com.veloq.app.dev sh -c 'cat > files/veloq-decisions.zip'") cat > "${dir}/zip" ;;
  *) echo "fake adb: unexpected call: $call" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return dir;
}

function run(dir: string, env: Record<string, string> = { ANDROID_SERIAL: HANDSET }) {
  const inherited = { ...process.env };
  delete inherited.ANDROID_SERIAL;
  const result = spawnSync(SCRIPT, [], {
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
  const zip = path.join(dir, 'zip');
  return {
    status: result.status,
    verdict: result.stdout.trim(),
    stderr: result.stderr,
    calls,
    zip: fs.existsSync(zip) ? fs.readFileSync(zip, 'utf8') : null,
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
