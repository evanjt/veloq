/**
 * Scenario: a job's gate runs the whole-tree guards while its work is only on disk. The guards
 * read the index, so the edit is judged as its base and passes, then fails at the landing that
 * stages it.
 * Expected behaviour: the stager stages the job's changes for the command it runs, leaves HEAD
 * and the index as it found them on exit whatever the command's status, and a guard reading the
 * index fails the edit once it is staged.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');
const STAGER = join(ROOT, 'scripts/stage-job-work.sh');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; base: string; guards: string } {
  const dir = mkdtempSync(join(tmpdir(), 'job-work-staged-'));
  roots.push(dir);
  const root = join(dir, 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  writeFileSync(join(root, '.gitignore'), 'ignored.log\n');
  initFixtureRepo(root);
  runGit(['commit', '-q', '-m', 'base'], root);
  const base = runGit(['rev-parse', 'HEAD'], root).trim();
  const guards = join(dir, 'guards.json');
  writeFileSync(
    guards,
    JSON.stringify([
      {
        name: 'fixture:no-forbidden',
        kind: 'correctness',
        cmd: ['sh', '-c', '! git grep --cached -q FORBIDDEN'],
        catches: 'a stand-in guard that reads the index',
      },
    ])
  );
  return { root, base, guards };
}

function stage(root: string, command: string[]) {
  const r = spawnSync('sh', [STAGER, ...command], {
    cwd: root,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

describe('stage-job-work.sh', () => {
  it('stages the job edit and its new file for the command it runs', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');
    writeFileSync(join(root, 'new.txt'), 'new\n');

    const result = stage(root, ['sh', '-c', 'git diff --cached --name-only']);

    expect(result.status).toBe(0);
    expect(result.output).toContain('tracked.txt');
    expect(result.output).toContain('new.txt');
  });

  it('puts the index back as it was found when the command passes', () => {
    const { root, base } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');
    writeFileSync(join(root, 'new.txt'), 'new\n');

    stage(root, ['true']);

    expect(runGit(['diff', '--cached', '--name-only'], root)).toBe('');
    expect(runGit(['status', '--porcelain'], root)).toContain(' M tracked.txt');
    expect(runGit(['status', '--porcelain'], root)).toContain('?? new.txt');
    expect(runGit(['rev-parse', 'HEAD'], root).trim()).toBe(base);
  });

  it('puts the index back and keeps the status when the command fails', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');

    const result = stage(root, ['sh', '-c', 'exit 3']);

    expect(result.status).toBe(3);
    expect(runGit(['diff', '--cached', '--name-only'], root)).toBe('');
  });

  it('restores an intent-to-add entry as it was', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'new.txt'), 'new\n');
    runGit(['add', '-N', 'new.txt'], root);

    stage(root, ['true']);

    expect(runGit(['status', '--porcelain'], root)).toContain(' A new.txt');
  });

  it('leaves an ignored file unstaged', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'ignored.log'), 'noise\n');
    writeFileSync(join(root, 'tracked.txt'), 'edited\n');

    const result = stage(root, ['sh', '-c', 'git diff --cached --name-only']);

    expect(result.output).toContain('tracked.txt');
    expect(result.output).not.toContain('ignored.log');
  });

  it('runs the command on a clean tree with nothing staged', () => {
    const { root } = fixture();

    const result = stage(root, ['sh', '-c', 'git diff --cached --name-only']);

    expect(result.status).toBe(0);
    expect(result.output.trim()).toBe('');
  });

  it('refuses a call with no command', () => {
    const { root } = fixture();

    expect(stage(root, []).status).toBe(2);
  });
});

describe('a guard reading the index over a job edit', () => {
  it('passes the edit while it is only on disk, and fails it once the gate stages it', () => {
    const { root, guards } = fixture();
    writeFileSync(join(root, 'tracked.txt'), 'FORBIDDEN\n');
    const command = ['node', RUNNER, '--set', 'commit', '--guards', guards];

    const unstaged = spawnSync(command[0], command.slice(1), {
      cwd: root,
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    const staged = stage(root, command);

    expect(unstaged.status).toBe(0);
    expect(staged.status).toBe(1);
    expect(staged.output).toContain('fixture:no-forbidden');
    expect(runGit(['diff', '--cached', '--name-only'], root)).toBe('');
  });
});
