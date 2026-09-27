/**
 * Scenario: the pre-commit formatter backed every commit up into `git stash`, one
 * stack shared by every worktree, so two trees committing together could take or
 * drop each other's entry.
 * Expected behaviour: formatting a commit writes and restages the fully staged
 * files, leaves a file with unstaged edits untouched, and never touches the stash.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = path.resolve(__dirname, '../../../scripts/format-staged.sh');

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, env: gitFreeEnv(), encoding: 'utf8' });
}

function fixture(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'format-staged-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(repo, 'config'));
  fs.writeFileSync(path.join(repo, 'config/.prettierrc'), '{}\n');
  fs.writeFileSync(path.join(repo, 'config/.prettierignore'), '');
  // A stand-in prettier: rewrites each .ts or .tsx argument to a known body.
  const bin = path.join(repo, 'node_modules/.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'prettier'),
    '#!/bin/sh\nfor a in "$@"; do case "$a" in *.ts|*.tsx) printf "formatted\\n" > "$a";; esac; done\n',
    { mode: 0o755 }
  );
  fs.mkdirSync(path.join(repo, 'src/app/(tabs)'), { recursive: true });
  for (const f of ['src/whole.ts', 'src/app/(tabs)/partial.tsx']) {
    fs.writeFileSync(path.join(repo, f), 'original\n');
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  return repo;
}

describe('format-staged.sh', () => {
  let repo: string;

  beforeEach(() => {
    repo = fixture();
    fs.writeFileSync(path.join(repo, 'src/whole.ts'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'src/app/(tabs)/partial.tsx'), 'staged\n');
    git(repo, 'add', 'src/whole.ts', 'src/app/(tabs)/partial.tsx');
    fs.writeFileSync(path.join(repo, 'src/app/(tabs)/partial.tsx'), 'staged\nunstaged\n');
    // An entry another worktree left, which the formatter must not touch.
    git(repo, 'stash', 'store', '-m', 'another tree', git(repo, 'stash', 'create').trim());
  });

  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('formats and restages a fully staged file', () => {
    execFileSync(SCRIPT, { cwd: repo, env: gitFreeEnv(), stdio: 'pipe' });
    expect(git(repo, 'show', ':src/whole.ts')).toBe('formatted\n');
  });

  it('leaves a file with unstaged edits as it is, staged and on disk', () => {
    execFileSync(SCRIPT, { cwd: repo, env: gitFreeEnv(), stdio: 'pipe' });
    expect(git(repo, 'show', ':src/app/(tabs)/partial.tsx')).toBe('staged\n');
    expect(fs.readFileSync(path.join(repo, 'src/app/(tabs)/partial.tsx'), 'utf8')).toBe(
      'staged\nunstaged\n'
    );
  });

  it('leaves the shared stash exactly as it found it', () => {
    const before = git(repo, 'stash', 'list', '--format=%H %gs');
    execFileSync(SCRIPT, { cwd: repo, env: gitFreeEnv(), stdio: 'pipe' });
    expect(git(repo, 'stash', 'list', '--format=%H %gs')).toBe(before);
  });

  it('formats a staged path git would quote, one with a non-ASCII character', () => {
    fs.writeFileSync(path.join(repo, 'src/café.ts'), 'accented\n');
    git(repo, 'add', 'src/café.ts');
    execFileSync(SCRIPT, { cwd: repo, env: gitFreeEnv(), stdio: 'pipe' });
    expect(git(repo, 'show', ':src/café.ts')).toBe('formatted\n');
  });

  it('does nothing when no TypeScript under src is staged', () => {
    git(repo, 'reset', '-q');
    expect(() =>
      execFileSync(SCRIPT, { cwd: repo, env: gitFreeEnv(), stdio: 'pipe' })
    ).not.toThrow();
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
  });
});
