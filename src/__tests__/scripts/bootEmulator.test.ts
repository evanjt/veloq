/**
 * Scenario: two jobs on one host each want an Android emulator and each boot
 * their own. Two emulators beside a native build push the host into swap.
 *
 * Expected behaviour: booting goes through one host-wide emulator lock. The
 * first boot launches the emulator and holds the lock until it has booted; a
 * second boot started at the same moment waits, names who holds the lock, and
 * then reuses the running emulator rather than launching another. A request
 * for a different image while one is running is refused, naming what runs.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/boot-emulator.sh');

/** The serial the stub emulator registers as, and invented image names. */
const SERIAL = 'emulator-5554';
const IMAGE = 'Quarry_Phone';
const OTHER_IMAGE = 'Orchard_Tablet';

/**
 * Stub `adb` and `emulator` in a directory of their own. The emulator logs its
 * launch, waits a moment as a boot does, then registers by writing `running`
 * with its image name; `adb` lists it from that file and answers its image
 * name and its boot property. `register: false` makes an emulator that exits
 * without ever registering, as one does on a broken image.
 */
function rig(running?: string, register = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-emulator-'));
  if (running) fs.writeFileSync(path.join(dir, 'running'), running);
  fs.writeFileSync(
    path.join(dir, 'adb'),
    [
      '#!/bin/sh',
      `state="${dir}/running"`,
      'if [ "$1" = "devices" ]; then',
      '  echo "List of devices attached"',
      `  [ ! -f "$state" ] || printf '${SERIAL}\\tdevice\\n'`,
      '  exit 0',
      'fi',
      `[ "$1" = "-s" ] && [ "$2" = "${SERIAL}" ] && [ -f "$state" ] || exit 1`,
      'shift 2',
      'case "$*" in',
      `  "emu avd name") cat "$state"; echo; echo OK ;;`,
      '  "shell getprop sys.boot_completed") echo 1 ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(dir, 'emulator'),
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${dir}/launches.log"`,
      'sleep 1',
      register ? `[ "$1" = "-avd" ] && printf '%s' "$2" > "${dir}/running"` : 'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    VELOQ_DEVICE_LOCK_DIR: dir,
    VELOQ_EMULATOR_POLL: '0.1',
    VELOQ_EMULATOR_BOOT_TIMEOUT: '20',
  };
  for (const name of [
    'ANDROID_SERIAL',
    'VELOQ_DEVICE_SERIAL',
    'VELOQ_DEVICE_LOCK',
    'VELOQ_DEVICE_LOCK_PATH',
    'VELOQ_DEVICE_LOCK_HELD',
    'VELOQ_EMULATOR_LOCK',
    'VELOQ_EMULATOR_LOCK_PATH',
    'VELOQ_EMULATOR_LOCK_HELD',
  ]) {
    delete env[name];
  }
  return { dir, env };
}

function boot(dir: string, env: NodeJS.ProcessEnv, image: string) {
  const child = spawn('sh', [SCRIPT, image], { cwd: dir, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on('close', (status) => resolve({ status, stdout: stdout.trim(), stderr }))
  );
}

function launches(dir: string): string[] {
  const log = path.join(dir, 'launches.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
}

describe('booting an emulator on a shared host', () => {
  it('launches one emulator for two boots started together', async () => {
    const { dir, env } = rig();

    const results = await Promise.all([boot(dir, env, IMAGE), boot(dir, env, IMAGE)]);

    expect(results.map((r) => r.status)).toEqual([0, 0]);
    expect(results.map((r) => r.stdout)).toEqual([SERIAL, SERIAL]);
    expect(launches(dir)).toHaveLength(1);
    expect(launches(dir)[0]).toContain(`-avd ${IMAGE}`);
  });

  it('names the boot that holds the host while another waits', async () => {
    const { dir, env } = rig();

    const first = boot(dir, env, IMAGE);
    for (let i = 0; i < 250 && launches(dir).length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const second = await boot(dir, env, IMAGE);
    await first;

    expect(second.status).toBe(0);
    expect(second.stdout).toBe(SERIAL);
    expect(second.stderr).toContain('boot-emulator: another session holds the emulator lock');
    expect(second.stderr).toContain(`avd=${IMAGE}`);
  });

  it('reuses an emulator already running the image asked for', async () => {
    const { dir, env } = rig(IMAGE);

    const result = await boot(dir, env, IMAGE);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(SERIAL);
    expect(launches(dir)).toEqual([]);
  });

  it('reuses whatever runs when no image is named', async () => {
    const { dir, env } = rig(OTHER_IMAGE);

    const result = await boot(dir, env, '');

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(SERIAL);
    expect(launches(dir)).toEqual([]);
  });

  it('refuses a second image while one runs, naming it', async () => {
    const { dir, env } = rig(OTHER_IMAGE);

    const result = await boot(dir, env, IMAGE);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`${SERIAL} is running ${OTHER_IMAGE}`);
    expect(launches(dir)).toEqual([]);
  });

  it('refuses a boot that names no image when none runs', async () => {
    const { dir, env } = rig();

    const result = await boot(dir, env, '');

    expect(result.status).not.toBe(0);
    expect(launches(dir)).toEqual([]);
  });

  it('fails an emulator that exits unregistered, and frees the lock for the next', async () => {
    const { dir, env } = rig(undefined, false);

    const failed = await boot(dir, env, IMAGE);

    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('boot-emulator: the emulator exited before it booted');

    fs.writeFileSync(path.join(dir, 'running'), IMAGE);
    const next = await boot(dir, env, IMAGE);
    expect(next.status).toBe(0);
    expect(next.stdout).toBe(SERIAL);
  });
});
