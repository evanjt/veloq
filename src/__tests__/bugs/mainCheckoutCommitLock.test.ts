/**
 * Scenario: a merge into the main checkout writes its tree into the shared
 * index and its gates then run for about a minute. Another session committing
 * in that same checkout during that minute takes the merged files with it,
 * under its own subject, and nothing warns: there is no `MERGE_HEAD` yet, so
 * the guard that refuses a commit during a merge has nothing to refuse. It has
 * happened: one commit carried all three of another session's merged files.
 *
 * Expected behaviour: the merge's gates hold a lock for as long as they run,
 * and a commit in the main checkout refuses while that lock is held, naming
 * the form to wait on. A commit in a worktree is untouched: it has an index of
 * its own and cannot pick up the merged tree.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/check-commit-lock.sh');

const roots: string[] = [];

/**
 * The environment with git's own variables taken out.
 *
 * A merge exports `GIT_DIR` and `GIT_INDEX_FILE` to its hooks, and they beat
 * `cwd`, so a fixture's `git worktree add` here ran against this repository
 * rather than against the scratch one. `pre-commit` unsets them for the same
 * reason; a test run from the merge gates has to do it for itself.
 */
function gitFreeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function scratch(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** Run the check with the lock pointed somewhere the fleet never looks. */
function run(cwd: string, lock: string): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: { ...gitFreeEnv(), VELOQ_COMMIT_LOCK: lock },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Hold the lock the way the merge gates do, for as long as `fn` takes. */
function whileHeld<T>(lock: string, fn: () => T): T {
  const holder = spawn('flock', [lock, 'sleep', '30'], {
    detached: true,
    stdio: 'ignore',
    env: gitFreeEnv(),
  });
  try {
    // `flock -n` failing is the proof the holder has it: spawning is not
    // taking, and a test that assumed it was would pass with no lock at all.
    const deadline = Date.now() + 5_000;
    for (;;) {
      const probe = spawnSync('flock', ['-n', lock, 'true'], { env: gitFreeEnv() });
      if (probe.status !== 0) break;
      if (Date.now() > deadline) throw new Error('the holder never took the lock');
    }
    return fn();
  } finally {
    holder.kill('SIGKILL');
  }
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: gitFreeEnv() });
}

/** A repository, and a worktree of it, so the two cases are the same tree. */
function repoWithWorktree(): { main: string; worktree: string } {
  const main = scratch('commit-lock-');
  writeFileSync(join(main, 'a.txt'), 'a\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 'test@example.com');
  git(main, 'config', 'user.name', 'Test');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '--no-verify', '-m', 'base');
  const worktree = join(scratch('commit-lock-wt-'), 'tree');
  git(main, 'worktree', 'add', '-q', worktree, '-b', 'side');
  return { main, worktree };
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('lets a commit through when nothing holds the lock', () => {
  const { main } = repoWithWorktree();
  const lock = join(scratch('lock-'), 'commit.lock');

  expect(run(main, lock).status).toBe(0);
});

it('refuses a main-checkout commit while a merge holds the lock, and says how to wait', () => {
  const { main } = repoWithWorktree();
  const lock = join(scratch('lock-'), 'commit.lock');

  const { status, output } = whileHeld(lock, () => run(main, lock));

  expect(status).toBe(1);
  expect(output).toContain('flock');
});

/**
 * The refusal used to print `flock $lock git commit ...`. That holds the lock
 * across the commit, so the hook's own probe fails against its parent and the
 * commit is refused again with the same advice, for ever, reading as a stale
 * lock.
 */
it('prints a wait that lands the commit once the merge lets go of the lock', async () => {
  const { main } = repoWithWorktree();
  const lock = join(scratch('lock-'), 'commit.lock');
  const hook = join(main, '.git/hooks/pre-commit');
  writeFileSync(hook, `#!/bin/sh\nVELOQ_COMMIT_LOCK='${lock}' exec sh '${SCRIPT}'\n`);
  chmodSync(hook, 0o755);
  writeFileSync(join(main, 'b.txt'), 'b\n');
  git(main, 'add', 'b.txt');

  const holder = spawn('flock', [lock, 'sleep', '30'], {
    detached: true,
    stdio: 'ignore',
    env: gitFreeEnv(),
  });
  const deadline = Date.now() + 5_000;
  while (spawnSync('flock', ['-n', lock, 'true'], { env: gitFreeEnv() }).status === 0) {
    if (Date.now() > deadline) throw new Error('the holder never took the lock');
  }

  const { output } = run(main, lock);
  const advice = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('flock '));
  expect(advice).toBeDefined();
  const command = (advice ?? '').replace('git commit ...', "git commit -qm 'waited for the merge'");

  const waiter = spawn('sh', ['-c', command], { cwd: main, env: gitFreeEnv(), stdio: 'pipe' });
  let waiterOutput = '';
  waiter.stdout.on('data', (chunk) => (waiterOutput += chunk));
  waiter.stderr.on('data', (chunk) => (waiterOutput += chunk));
  const exited = new Promise<number | null>((done) => waiter.on('exit', done));
  await new Promise((done) => setTimeout(done, 300));
  // The whole group: `flock` hands its descriptor to `sleep`, so killing
  // `flock` alone leaves the lock held.
  process.kill(-(holder.pid ?? 0), 'SIGKILL');

  expect({ status: await exited, output: waiterOutput }).toEqual({ status: 0, output: '' });
  expect(
    execFileSync('git', ['log', '-1', '--format=%s'], { cwd: main, env: gitFreeEnv() })
      .toString()
      .trim()
  ).toBe('waited for the merge');
});

it('says never to wrap the commit itself in the lock', () => {
  const { main } = repoWithWorktree();
  const lock = join(scratch('lock-'), 'commit.lock');

  const { output } = whileHeld(lock, () => run(main, lock));

  expect(output).toMatch(/[Nn]ever wrap/);
  expect(output).not.toMatch(/flock \S+ git commit/);
});

it('lets a worktree commit through while the lock is held, since its index is its own', () => {
  const { worktree } = repoWithWorktree();
  const lock = join(scratch('lock-'), 'commit.lock');

  expect(whileHeld(lock, () => run(worktree, lock)).status).toBe(0);
});

describe('the hooks are the callers', () => {
  const preCommit = readFileSync(join(REPO, '.husky/pre-commit'), 'utf8');
  const mergeGates = readFileSync(join(REPO, 'scripts/merge-gates.sh'), 'utf8');

  it('runs the check from pre-commit', () => {
    expect(preCommit).toContain('check-commit-lock.sh');
  });

  it('holds the lock around the merge gates, which is the window it guards', () => {
    expect(mergeGates).toContain('flock');
  });
});
