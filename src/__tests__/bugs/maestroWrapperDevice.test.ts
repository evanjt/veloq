/**
 * Scenario: two handsets are attached and the run is pinned to one of them
 * through `ANDROID_SERIAL`. The device lock is taken on that serial and every
 * `adb` call in the session reaches it, but Maestro is handed no device and
 * picks the first transport itself, which is the other phone.
 *
 * Expected behaviour: the wrapper resolves the serial the lock resolves and
 * passes it to Maestro as `--device`, ahead of the subcommand, and refuses
 * when several are attached and none is named.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/with-maestro.sh');

const S22 = '192.168.1.118:5555';
const ONEPLUS = '10.0.0.3:5555';

function fakeBins(dir: string, attached: string[]): void {
  const listing = ['List of devices attached', ...attached.map((s) => `${s}\tdevice`), ''].join(
    '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'adb'),
    `#!/usr/bin/env bash\nif [ "$1" = "devices" ]; then\n  cat <<'EOF'\n${listing}EOF\n  exit 0\nfi\nexit 0\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(dir, 'maestro'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/calls.log"\nexit 0\n`,
    { mode: 0o755 }
  );
}

function run(attached: string[], serial?: string, args: string[] = ['test', 'flow.yaml']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-maestro-'));
  fakeBins(dir, attached);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    // The lock is the caller's here, as it is under `device-lock-shell.sh`,
    // so the wrapper runs its own body rather than re-execing.
    VELOQ_DEVICE_LOCK_HELD: '1',
  };
  delete env.ANDROID_SERIAL;
  if (serial) env.ANDROID_SERIAL = serial;

  let status = 0;
  let stderr = '';
  try {
    execFileSync('bash', [SCRIPT, ...args], { cwd: dir, encoding: 'utf8', env });
  } catch (e) {
    const err = e as { status: number; stderr: string };
    status = err.status;
    stderr = err.stderr;
  }
  const log = path.join(dir, 'calls.log');
  return {
    status,
    stderr,
    calls: fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      : [],
  };
}

describe('the Maestro wrapper and the handset it reaches', () => {
  it('pins the serial the run is locked to, ahead of the subcommand', () => {
    const result = run([ONEPLUS, S22], S22);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toBe(`--device ${S22} test flow.yaml`);
    expect(result.calls[0]).not.toContain(ONEPLUS);
  });

  it('pins the only handset attached when none is named', () => {
    const result = run([S22]);

    expect(result.status).toBe(0);
    expect(result.calls[0]).toBe(`--device ${S22} test flow.yaml`);
  });

  it('refuses rather than let Maestro choose between two', () => {
    const result = run([ONEPLUS, S22]);

    expect(result.status).not.toBe(0);
    expect(result.calls).toHaveLength(0);
    expect(result.stderr).toContain(ONEPLUS);
    expect(result.stderr).toContain(S22);
    expect(result.stderr).toContain('ANDROID_SERIAL');
  });

  it('leaves a device the caller named alone', () => {
    const result = run([ONEPLUS, S22], S22, ['--device', ONEPLUS, 'test', 'flow.yaml']);

    expect(result.status).toBe(0);
    expect(result.calls[0]).toBe(`--device ${ONEPLUS} test flow.yaml`);
    expect(result.calls[0]).not.toContain(S22);
  });
});
