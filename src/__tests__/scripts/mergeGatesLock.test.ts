/**
 * Scenario: `pre-merge-commit` runs the gates holding the commit lock, and an
 * agent wrapped the merge itself in the same lock. A flock is held per open
 * file description, so the hook's child waited on the lock its own parent held
 * and the merge sat for 22 minutes with no output. The merged tree was already
 * in the shared index by then, so every other worktree's merge was refused with
 * "your local changes would be overwritten".
 *
 * Expected behaviour: gates that cannot take the lock refuse and say so. A
 * merge that cannot be gated is a merge that should stop, not hang.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/merge-gates.sh');

/** A lock of this test's own, so nothing here waits on the fleet's checkout. */
function privateLock(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-merge-')), 'lock');
}

/** Hold `lock` until the returned function is called. */
function holder(lock: string): () => void {
  const child = spawn('flock', [lock, 'sh', '-c', 'echo held; sleep 30'], { stdio: 'pipe' });
  return () => child.kill();
}

describe('the merge gates and the commit lock', () => {
  it('refuses rather than blocking when the lock is held', async () => {
    const lock = privateLock();
    const release = holder(lock);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const run = spawnSync(script, {
      encoding: 'utf8',
      env: { ...process.env, VELOQ_COMMIT_LOCK: lock, VELOQ_MERGE_LOCK_HELD: '' },
      timeout: 20_000,
      cwd: projectRoot,
    });
    release();

    // Killed on the timeout rather than exiting is the hang under test.
    expect(run.signal).toBeNull();
    expect(run.status).not.toBe(0);
    expect(`${run.stderr}${run.stdout}`).toMatch(/lock/i);
  }, 40_000);

  it('takes the lock without waiting, so a merge cannot wait on itself', () => {
    const source = fs.readFileSync(script, 'utf8');

    expect(source).toMatch(/flock -n /);
    expect(source).not.toMatch(/exec flock "\$\{VELOQ_COMMIT_LOCK/);
  });
});
