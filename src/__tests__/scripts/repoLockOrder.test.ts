/**
 * Scenario: two sessions each need the merge lock and the build lock, and they
 * ask for them in opposite orders.
 *
 * Expected behaviour: both finish. The merge lock and the build lock were
 * split apart and the ordering rule was left in prose, so on 2026-09-11 one
 * session held the build lock and merged under it while another held the merge
 * lock and waited for the build lock. Nothing on the machine merged for about fifty minutes and four
 * processes sat on the merge lock behind a holder that was itself waiting.
 *
 * Two things break that: the locks are always taken in one canonical order
 * whatever order the caller names them, and the wait for each is bounded, so a
 * waiter releases what it holds and starts again rather than holding forever.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/with-repo-locks.sh');

function tempLocks(): { a: string; b: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-locks-'));
  return { a: path.join(dir, 'a.lock'), b: path.join(dir, 'b.lock'), dir };
}

describe('repository locks are taken in one order', () => {
  it('runs the command and keeps its exit code', () => {
    const { a, b } = tempLocks();
    const ok = spawnSync(script, [a, b, '--', 'echo', 'ran'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('ran');
    expect(spawnSync(script, [a, '--', 'false'], { encoding: 'utf8' }).status).not.toBe(0);
  });

  /// Scenario: 99 is flock's own "deadline passed" code, and the retry loop
  /// reads it as contention. A wrapped command that exits 99 itself was then
  /// retried forever, spinning while holding nothing.
  ///
  /// Expected behaviour: the command's own 99 reaches the caller as a plain
  /// failure, so only flock's 99 means contention.
  it('does not retry forever when the command itself exits 99', () => {
    const { a } = tempLocks();
    const ran = spawnSync(script, [a, '--', 'sh', '-c', 'exit 99'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(ran.signal).toBeNull();
    expect(ran.status).not.toBeNull();
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).not.toContain('releasing and retrying');
  });

  it('keeps a command exit of 99 distinguishable from success across two locks', () => {
    const { a, b } = tempLocks();
    const ran = spawnSync(script, [a, b, '--', 'sh', '-c', 'exit 99'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(ran.signal).toBeNull();
    expect(ran.status).not.toBe(0);
    expect(ran.stderr).not.toContain('releasing and retrying');
  });

  it('sorts the locks, so the order named does not decide the order taken', () => {
    const { a, b } = tempLocks();
    const forwards = spawnSync(script, ['--print-order', a, b, '--', 'true'], { encoding: 'utf8' });
    const backwards = spawnSync(script, ['--print-order', b, a, '--', 'true'], {
      encoding: 'utf8',
    });
    expect(forwards.stdout).toBe(backwards.stdout);
    expect(forwards.stdout.trim().split('\n')).toHaveLength(2);
  });

  it('does not deadlock when two callers name the locks in opposite orders', async () => {
    const { a, b } = tempLocks();
    const run = (first: string, second: string) =>
      new Promise<number | null>((resolve) => {
        const child = spawn(script, [first, second, '--', 'sh', '-c', 'sleep 0.3'], {
          stdio: 'ignore',
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

    expect(await Promise.all([run(a, b), run(b, a)])).toEqual([0, 0]);
  });

  it('gives up a lock it holds rather than waiting on the next one forever', async () => {
    const { a, b } = tempLocks();
    // Hold b, so the script takes a and then cannot have b. It must let a go.
    const holder = spawn('flock', [b, 'sh', '-c', 'sleep 8'], { stdio: 'ignore' });
    const waiter = spawn(script, [a, b, '--', 'echo', 'through'], {
      stdio: 'ignore',
      env: { ...process.env, VELOQ_LOCK_WAIT_SECS: '1' },
    });

    // While the waiter is retrying, a must come free often enough for a third
    // caller to take it. A held-and-waiting lock would never let this through,
    // and the deadline here is shorter than the holder keeps b.
    const probe = spawnSync('flock', ['-w', '5', a, 'true']);
    expect(probe.status).toBe(0);

    await new Promise<void>((r) => waiter.on('close', () => r()));
    holder.kill('SIGKILL');
  }, 25000);
});

describe('merging goes through it', () => {
  it('the merge helper takes the merge lock and not the build lock', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'scripts/merge-audit-branch.sh'), 'utf8');
    expect(source).toContain('veloq-merge.lock');
    expect(source).not.toContain('veloq-build.lock');
    expect(source).toContain('with-repo-locks.sh');
  });
});
