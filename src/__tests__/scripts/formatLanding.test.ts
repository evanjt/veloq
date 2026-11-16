/**
 * Scenario: a landing batch whose merged file differs from prettier's output
 * only in layout was refused by the format lane of the landing gate, so the
 * whole batch went back for formatting alone. Prettier's output is
 * deterministic, so the gate can write it rather than refuse on it.
 *
 * Expected behaviour: at a landing, the files the batch changed that the format
 * check judges are formatted and committed over the batch before the other
 * lanes read the tree. A landing already formatted gets no commit, nothing
 * outside the format check's scope is touched, and staged work in the landing
 * tree is refused rather than swept into the format commit.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');

const TIDY = "export const a = '1';\n";
const UNTIDY = 'export  const   a="1"\n';
const NOTES = '# notes\n\n\n\nbody   \n';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: gitFreeEnv(),
  });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

function copy(root: string, path: string, mode = 0o644): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  copyFileSync(join(REPO, path), full);
  chmodSync(full, mode);
}

/**
 * A repository with the real scripts, the real prettier config and ignore file,
 * and prettier itself through a link to the checkout's install.
 */
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'format-landing-')));
  roots.push(root);
  copy(root, 'scripts/format-landing.sh', 0o755);
  copy(root, 'scripts/format-scope.sh', 0o755);
  copy(root, 'scripts/check-merge-format.sh', 0o755);
  copy(root, 'config/.prettierrc');
  copy(root, 'config/.prettierignore');
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));
  write(root, { 'src/a.ts': TIDY, '.gitignore': 'node_modules\n' });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', 'base');
  return root;
}

/** Commit `files` as the batch's merge, and return the head it landed on. */
function landed(root: string, files: Record<string, string>): string {
  const base = git(root, 'rev-parse', 'HEAD').trim();
  write(root, files);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', 'landed');
  return base;
}

function run(
  root: string,
  script: string,
  args: string[] = [],
  env: Record<string, string> = {}
): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [join(root, script), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...gitFreeEnv(), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function head(root: string): string {
  return git(root, 'rev-parse', 'HEAD').trim();
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

it('formats a landed file prettier would rewrite, and commits the layout over the batch', () => {
  const root = fixture();
  const base = landed(root, { 'src/b.ts': UNTIDY });

  const { status } = run(root, 'scripts/format-landing.sh', [base]);

  expect(status).toBe(0);
  expect(read(root, 'src/b.ts')).toBe(TIDY);
  expect(git(root, 'log', '-1', '--format=%s').trim()).toBe('Format the merged files');
  expect(git(root, 'status', '--porcelain')).toBe('');
});

it('leaves the format lane passing once the layout is committed', () => {
  const root = fixture();
  const base = landed(root, { 'src/b.ts': UNTIDY });
  run(root, 'scripts/format-landing.sh', [base]);

  const lane = run(root, 'scripts/check-merge-format.sh', [], { VELOQ_MERGE_BASE: base });

  expect(lane.status).toBe(0);
});

it('commits nothing for a landing already formatted, however often it runs', () => {
  const root = fixture();
  const base = landed(root, { 'src/b.ts': TIDY });
  const before = head(root);

  expect(run(root, 'scripts/format-landing.sh', [base]).status).toBe(0);
  expect(run(root, 'scripts/format-landing.sh', [base]).status).toBe(0);

  expect(head(root)).toBe(before);
});

it('touches only the files the format check judges', () => {
  const root = fixture();
  const base = landed(root, { 'src/b.ts': UNTIDY, 'docs/notes.md': NOTES });

  run(root, 'scripts/format-landing.sh', [base]);

  expect(git(root, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('src/b.ts');
  expect(read(root, 'docs/notes.md')).toBe(NOTES);
});

it('formats a landed file whose name has a space in it', () => {
  const root = fixture();
  const base = landed(root, { 'src/two words.ts': UNTIDY });

  expect(run(root, 'scripts/format-landing.sh', [base]).status).toBe(0);

  expect(read(root, 'src/two words.ts')).toBe(TIDY);
});

it('refuses to commit over staged work in the landing tree, and leaves the batch as it was', () => {
  const root = fixture();
  const base = landed(root, { 'src/b.ts': UNTIDY });
  write(root, { 'src/neighbour.ts': UNTIDY });
  git(root, 'add', 'src/neighbour.ts');
  const before = head(root);

  const { status, output } = run(root, 'scripts/format-landing.sh', [base]);

  expect(status).not.toBe(0);
  expect(output).toContain('src/neighbour.ts');
  expect(head(root)).toBe(before);
  expect(read(root, 'src/b.ts')).toBe(UNTIDY);
});

it('fails without a commit when a landed file prettier cannot parse', () => {
  const root = fixture();
  const base = landed(root, { 'src/broken.ts': 'export const = ;\n' });
  const before = head(root);

  const { status } = run(root, 'scripts/format-landing.sh', [base]);

  expect(status).not.toBe(0);
  expect(head(root)).toBe(before);
});
