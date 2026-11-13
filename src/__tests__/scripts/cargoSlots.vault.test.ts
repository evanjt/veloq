/**
 * Scenario: every job tree on a host starts a cargo build at once, each with
 * eight compiler jobs, and the host runs out of memory and stops answering.
 *
 * Expected behaviour: `with-cargo-slot.sh` admits at most its limit of builds
 * across the machine and queues the rest, passes each build's exit status
 * through, takes no second slot for a build started inside one, and frees the
 * slot when the build ends even if the build left a daemon running.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '../../../modules/veloqrs/scripts/with-cargo-slot.sh');

let box: string;

beforeEach(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'cargo-slots-'));
});

afterEach(() => fs.rmSync(box, { recursive: true, force: true }));

function env(limit: number): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.VELOQ_CARGO_SLOT_HELD;
  return {
    ...base,
    VELOQ_CARGO_SLOTS: String(limit),
    VELOQ_CARGO_SLOT_DIR: path.join(box, 'slots'),
  };
}

function run(limit: number, ...command: string[]) {
  return spawnSync('bash', [SCRIPT, ...command], {
    encoding: 'utf8',
    env: env(limit),
    timeout: 20000,
  });
}

it('never admits more builds than its limit', async () => {
  const running = path.join(box, 'running');
  const seen = path.join(box, 'seen');
  fs.mkdirSync(running);
  // Each build marks itself running, records how many are, holds a second and leaves.
  const build = `touch "${running}/$$"; ls "${running}" | wc -l >> "${seen}"; sleep 1; rm "${running}/$$"`;

  const codes = await Promise.all(
    Array.from(
      { length: 8 },
      () =>
        new Promise<number>((resolve) => {
          const child = spawn('bash', [SCRIPT, 'sh', '-c', build], {
            env: env(3),
            stdio: 'ignore',
          });
          child.on('close', (code) => resolve(code ?? -1));
        })
    )
  );

  expect(codes).toEqual(Array(8).fill(0));
  const counts = fs.readFileSync(seen, 'utf8').trim().split('\n').map(Number);
  expect(counts).toHaveLength(8);
  expect(Math.max(...counts)).toBeLessThanOrEqual(3);
  expect(Math.max(...counts)).toBeGreaterThan(1);
}, 30000);

it('passes the build’s exit status through', () => {
  expect(run(2, 'sh', '-c', 'exit 7').status).toBe(7);
  expect(run(2, 'true').status).toBe(0);
});

it('takes no second slot for a build started inside one', () => {
  const result = run(1, 'bash', SCRIPT, 'sh', '-c', 'echo inner');

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('inner');
});

it('frees the slot when the build ends, even with a daemon it started still running', () => {
  const pid = path.join(box, 'daemon.pid');
  expect(run(1, 'sh', '-c', `sleep 30 >/dev/null 2>&1 & echo $! > "${pid}"`).status).toBe(0);

  try {
    const started = Date.now();
    const result = run(1, 'true');

    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  } finally {
    process.kill(Number(fs.readFileSync(pid, 'utf8')));
  }
});

it('refuses a limit that is not a positive count', () => {
  const result = run(0, 'true');

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('VELOQ_CARGO_SLOTS');
});
