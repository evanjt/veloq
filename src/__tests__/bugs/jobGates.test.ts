/**
 * Scenario: a job's branch carries a file the shared landing battery refuses,
 * and nothing on the job's side runs that battery, so the landing tree finds it
 * and a second job is spent on the fix.
 *
 * Expected behaviour: `scripts/job-gates.sh`, run from the job's worktree,
 * runs the merge battery against the merge base with main, including work not
 * yet committed, names the step that failed, leaves the worktree as it found
 * it, and refuses the main checkout and a landing tree.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const OFFENCE = "import { Text } from 'react-native';\nexport const a = Text;\n";

/** The battery in the scratch repository: the one real guard that judges a branch's own files. */
const BATTERY = `#!/bin/sh
step=guards
echo "$step" > "$VELOQ_GATE_REPORT"
node "${REPO}/scripts/lint-react-native-text.mjs" --root . --baseline baseline.json
code=$?
[ "$code" -eq 0 ] && : > "$VELOQ_GATE_REPORT"
exit $code
`;

const boxes: string[] = [];
afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, env: gitFreeEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function write(root: string, path: string, contents: string, mode = 0o644): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  chmodSync(full, mode);
}

/** A scratch main checkout with the real script, and a job worktree beside it. */
function fixture(): { main: string; job: string } {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'job-gates-')));
  boxes.push(box);
  const main = join(box, 'veloq');
  mkdirSync(main);
  mkdirSync(join(main, 'scripts/lib'), { recursive: true });
  copyFileSync(join(REPO, 'scripts/job-gates.sh'), join(main, 'scripts/job-gates.sh'));
  chmodSync(join(main, 'scripts/job-gates.sh'), 0o755);
  write(main, 'scripts/merge-gates.sh', BATTERY, 0o755);
  write(main, 'baseline.json', '[]\n');
  write(main, 'src/base.ts', 'export const base = 1;\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'commit.gpgsign', 'false');
  git(main, 'add', '-A');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', 'base');
  const job = join(box, 'veloq-job');
  git(main, 'worktree', 'add', '-q', job, '-b', 'job');
  return { main, job };
}

function run(cwd: string, env: Record<string, string> = {}): { status: number; output: string } {
  const result = spawnSync('sh', ['scripts/job-gates.sh'], {
    cwd,
    env: { ...gitFreeEnv(), ...env },
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

function commit(root: string, message: string): void {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '-q', '-m', message);
}

describe('job-gates.sh', () => {
  it('fails naming the guards step for a committed offence', () => {
    const { job } = fixture();
    write(job, 'src/offence.tsx', OFFENCE);
    commit(job, 'offence');

    const result = run(job);

    expect(result.status).toBe(1);
    expect(result.output).toMatch(/failed at step: guards/);
    expect(result.output).toContain('src/offence.tsx');
  }, 60_000);

  it('passes once the offence is gone', () => {
    const { job } = fixture();
    write(job, 'src/fine.ts', 'export const fine = 1;\n');
    commit(job, 'fine');

    expect(run(job).status).toBe(0);
  }, 60_000);

  it('judges uncommitted work and leaves the worktree as it found it', () => {
    const { job } = fixture();
    const head = git(job, 'rev-parse', 'HEAD');
    write(job, 'src/staged.ts', 'export const staged = 1;\n');
    git(job, 'add', 'src/staged.ts');
    write(job, 'src/offence.tsx', OFFENCE);

    const result = run(job);

    expect(result.status).toBe(1);
    expect(result.output).toContain('src/offence.tsx');
    expect(git(job, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(job, 'diff', '--cached', '--name-only').trim()).toBe('src/staged.ts');
    expect(existsSync(join(job, 'src/offence.tsx'))).toBe(true);
    expect(readFileSync(join(job, 'src/offence.tsx'), 'utf8')).toBe(OFFENCE);
  }, 60_000);

  it('judges the range from VELOQ_MERGE_BASE when given', () => {
    const { job } = fixture();
    write(job, 'src/offence.tsx', OFFENCE);
    commit(job, 'offence');
    write(job, 'src/after.ts', 'export const after = 1;\n');
    commit(job, 'after');
    const lastCommit = git(job, 'rev-parse', 'HEAD').trim();

    // The stand-in battery judges the whole tree, so the base reaching it is what is read back.
    write(job, 'scripts/merge-gates.sh', `#!/bin/sh\necho "base=$VELOQ_MERGE_BASE"\n`, 0o755);
    commit(job, 'echo base');
    const result = run(job, { VELOQ_MERGE_BASE: lastCommit });

    expect(result.status).toBe(0);
    expect(result.output).toContain(`base=${lastCommit}`);
  }, 60_000);

  it('refuses the main checkout', () => {
    const { main } = fixture();

    const result = run(main);

    expect(result.status).toBe(2);
    expect(result.output).toMatch(/main checkout/);
  }, 60_000);

  it('refuses a landing tree', () => {
    const { main, job } = fixture();
    const landing = `${main}-landing`;
    git(main, 'worktree', 'add', '-q', '--detach', landing);

    const result = run(landing);

    expect(result.status).toBe(2);
    expect(result.output).toMatch(/landing tree/);
    expect(existsSync(job)).toBe(true);
  }, 60_000);
});
