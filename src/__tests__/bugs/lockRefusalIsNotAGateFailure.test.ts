/**
 * Scenario: `merge-gates.sh` exits 1 both when a gate fails and when it cannot
 * take the commit lock, so `post-merge` reported a concurrent merge's lock as
 * "THE GATES FAIL ON THE MERGED TREE" and told the agent to reset main. On
 * 2026-09-18 that tree passed tsc, lint, audit, Jest and rustfmt.
 *
 * Expected behaviour: a lock refusal carries its own exit code, and the hook
 * says the gates did not run rather than that they failed, with no reset.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/merge-gates.sh');

/** The exit code that means the lock was held, not that a gate failed. */
const LOCK_HELD = 66;

function privateLock(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-lockcode-')), 'lock');
}

function holder(lock: string): () => void {
  const child = spawn('flock', [lock, 'sh', '-c', 'echo held; sleep 30'], { stdio: 'pipe' });
  return () => child.kill();
}

describe('a held lock is told apart from a failing gate', () => {
  it('exits with the lock code rather than 1', async () => {
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

    expect(run.signal).toBeNull();
    expect(run.status).toBe(LOCK_HELD);
  }, 40_000);

  it('does not tell post-merge to reset the branch over a lock', () => {
    const hook = fs.readFileSync(path.join(projectRoot, '.husky/post-merge'), 'utf8');
    const printed = hook.split('\n').filter((line) => line.trim().startsWith('echo '));

    expect(hook).toMatch(new RegExp(`-eq ${LOCK_HELD}`));

    // The alarm belongs to a real gate failure only. No line offers a reset
    // for either case: the checkout is shared, and a reset there discards
    // every other session's staged and unstaged work.
    const alarm = printed.findIndex((line) => line.includes('THE GATES FAIL'));

    expect(alarm).toBeGreaterThan(-1);
    expect(printed.some((line) => line.includes('reset --hard'))).toBe(false);
    expect(printed.some((line) => /Do not reset/.test(line))).toBe(true);
  });
});
