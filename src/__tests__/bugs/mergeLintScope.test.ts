/**
 * Scenario: the merge hook ran `npm run lint`, which counts warnings over the
 * working tree. Every worktree merges into the one shared checkout, so a
 * warning in a file another session had open there failed a merge that never
 * touched it, and the ceiling sits exactly on the tree's count so nothing
 * absorbed it.
 *
 * Expected behaviour: a merge is judged on the tree it is about to commit. The
 * check lints a copy taken from the index, so an unstaged edit beside it is
 * neither counted nor blamed, and a staged file that is genuinely over the
 * ceiling still fails.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/check-merge-lint.sh');

/** Clean under the fixture's config: no warnings, no errors. */
const CLEAN = 'export const a = 1;\n';
/** One `no-unused-vars` warning, which is what the fixture ceiling counts. */
const WARNING = 'const unused = 1;\nexport const b = 2;\n';

const CONFIG = `module.exports = [
  {
    files: ['**/*.js'],
    rules: { 'no-unused-vars': 'warn' },
  },
];
`;

const roots: string[] = [];

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
}

/**
 * A repository whose `lint` script carries `ceiling`, with `committed` in the
 * first commit and `staged` staged on top of it.
 */
function fixture(
  ceiling: number,
  committed: Record<string, string>,
  staged: Record<string, string> = {}
): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-lint-'));
  roots.push(root);
  write(root, {
    'eslint.config.js': CONFIG,
    'package.json': JSON.stringify(
      {
        name: 'fixture',
        scripts: { lint: `eslint . --no-warn-ignored --max-warnings ${ceiling}` },
      },
      null,
      2
    ),
    ...committed,
  });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', 'base');
  write(root, staged);
  for (const path of Object.keys(staged)) git(root, 'add', path);
  return root;
}

function run(cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, VELOQ_MERGE_LINT_REPO: REPO },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('passes a tree that sits on its ceiling', () => {
  const root = fixture(1, { 'a.js': WARNING });

  expect(run(root).status).toBe(0);
});

it('ignores an unstaged file the merge never touched', () => {
  const root = fixture(1, { 'a.js': WARNING });
  write(root, { 'other.js': WARNING });

  const { status, output } = run(root);

  expect(status).toBe(0);
  expect(output).not.toContain('other.js');
});

it('counts the index, not the disk, for a file edited again after staging', () => {
  const root = fixture(1, { 'a.js': WARNING });
  // Two more warnings on disk, none of them staged.
  write(root, { 'a.js': `${WARNING}const second = 1;\nconst third = 2;\n` });

  expect(run(root).status).toBe(0);
});

it('fails a merge whose own tree is over the ceiling', () => {
  const root = fixture(1, { 'a.js': WARNING }, { 'b.js': WARNING });

  expect(run(root).status).not.toBe(0);
});

it('reads the ceiling out of the merged tree, not out of the checkout it runs in', () => {
  const root = fixture(0, { 'a.js': CLEAN });
  // The merge raises its own ceiling and adds the warning that needs it.
  write(root, {
    'package.json': JSON.stringify(
      { name: 'fixture', scripts: { lint: 'eslint . --no-warn-ignored --max-warnings 1' } },
      null,
      2
    ),
    'b.js': WARNING,
  });
  git(root, 'add', 'package.json', 'b.js');

  expect(run(root).status).toBe(0);
});

it('removes its copy on the failing path as well as the passing one', () => {
  const copies = () => readdirSync(tmpdir()).filter((name) => name.startsWith('veloq-merge-lint'));
  const before = copies();

  run(fixture(1, { 'a.js': WARNING }));
  run(fixture(1, { 'a.js': WARNING }, { 'b.js': WARNING }));

  expect(copies()).toEqual(before);
});

describe('the merge hook is the caller', () => {
  const hook =
    readFileSync(join(REPO, '.husky/pre-merge-commit'), 'utf8') +
    readFileSync(join(REPO, 'scripts/merge-gates.sh'), 'utf8');

  const commands = hook
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  it('runs the merge-scoped lint, not the working-tree one', () => {
    expect(commands).toContain('./scripts/check-merge-lint.sh');
    expect(commands).not.toContain('npm run lint');
  });

  it('leaves the commit hook linting the working tree, which is a commit tree', () => {
    const precommit = readFileSync(join(REPO, '.husky/pre-commit'), 'utf8');
    const gates = readFileSync(join(REPO, 'scripts/run-gates.sh'), 'utf8');
    expect(`${precommit}${gates}`).toMatch(/lint/);
  });
});
