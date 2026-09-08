/**
 * Scenario: `pre-merge-commit` ran `format:check` over the working tree, so a
 * session with an unformatted file open in the main checkout failed every
 * merge anyone attempted, on a file the merge had never touched. The blocked
 * session had no clean move: formatting it rewrites another session's work,
 * and this hook has no way to skip one gate.
 *
 * Expected behaviour: a merge is judged on the tree it is about to commit. The
 * check reads each staged path out of the index, so an unstaged edit beside it
 * is neither read nor blamed, and a staged path that is genuinely unformatted
 * still fails.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/check-merge-format.sh');

const TIDY = 'export const a = 1;\n';
const UNTIDY = 'export  const   a="1"\n';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

/** A repository with one commit, then `staged` staged on top of it. */
function fixture(committed: Record<string, string>, staged: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-format-'));
  roots.push(root);
  write(root, committed);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', 'base');
  write(root, staged);
  for (const path of Object.keys(staged)) git(root, 'add', path);
  return root;
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
}

function run(cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, VELOQ_MERGE_FORMAT_REPO: REPO },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('passes a merge whose staged files are formatted', () => {
  const root = fixture({ 'src/a.ts': TIDY }, { 'src/b.ts': TIDY });

  expect(run(root).status).toBe(0);
});

it('ignores an unstaged file the merge never touched, however it is formatted', () => {
  const root = fixture({ 'src/a.ts': TIDY }, { 'src/b.ts': TIDY });
  write(root, { 'src/other.ts': UNTIDY });

  const { status, output } = run(root);

  expect(status).toBe(0);
  expect(output).not.toContain('other.ts');
});

it('reads the index, not the disk, for a staged file edited again afterwards', () => {
  const root = fixture({ 'src/a.ts': TIDY }, { 'src/b.ts': TIDY });
  write(root, { 'src/b.ts': UNTIDY });

  expect(run(root).status).toBe(0);
});

it('fails a staged file that is genuinely unformatted, and names it', () => {
  const root = fixture({ 'src/a.ts': TIDY }, { 'src/b.ts': UNTIDY });

  const { status, output } = run(root);

  expect(status).toBe(1);
  expect(output).toContain('src/b.ts');
});

it('passes when the merge stages nothing under src', () => {
  const root = fixture({ 'src/a.ts': TIDY }, { 'docs/notes.md': '# notes\n' });

  expect(run(root).status).toBe(0);
});

describe('the merge hook is the caller', () => {
  const hook = readFileSync(join(REPO, '.husky/pre-merge-commit'), 'utf8');

  const commands = hook
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  it('runs the merge-scoped check, not the working-tree glob', () => {
    expect(commands).toContain('./scripts/check-merge-format.sh');
    expect(commands).not.toContain('npm run audit');
  });

  it('still runs every other guard the audit holds', () => {
    expect(hook).toMatch(/npm run audit:guards/);
  });

  it('leaves a plain audit run checking the whole tree, for a commit and for CI', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts.audit).toMatch(/format:check/);
    expect(pkg.scripts['audit:guards']).not.toMatch(/format:check/);
  });
});
