/**
 * Scenario: the merge hook ran `npm run lint`, which counts warnings over the
 * working tree. Every worktree merges into the one shared checkout, so a
 * warning in a file another session had open there failed a merge that never
 * touched it, and the ceiling sits exactly on the tree's count so nothing
 * absorbed it.
 *
 * Expected behaviour: a merge is judged on the tree it is about to commit. The
 * check lints a copy taken from the index, so an unstaged edit beside it is
 * neither counted nor blamed, and a staged warning still fails. The tree holds
 * no warnings, so the merged `lint` script has to say `--max-warnings 0`, and a
 * merge that raises it is refused rather than obeyed.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/check-merge-lint.sh');

/** Clean under the fixture's config: no warnings, no errors. */
const CLEAN = 'export const a = 1;\n';
/** One `no-unused-vars` warning, which is one more than the tree may hold. */
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
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: gitFreeEnv() });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
}

const LINT_ZERO = 'eslint . --no-warn-ignored --max-warnings 0';

function packageJson(lint: string): string {
  return JSON.stringify({ name: 'fixture', scripts: { lint } }, null, 2);
}

/**
 * A repository whose `lint` script is the repository's own shape, with
 * `committed` in the first commit and `staged` staged on top of it.
 */
function fixture(committed: Record<string, string>, staged: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'merge-lint-'));
  roots.push(root);
  write(root, {
    'eslint.config.js': CONFIG,
    'package.json': packageJson(LINT_ZERO),
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

/**
 * A temp directory of the run's own, so what it holds afterwards is this run's
 * leftovers alone. The system one is shared with every landing on the machine,
 * and each of those makes the same copy while its gates run.
 */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-lint-tmp-'));
  roots.push(dir);
  return dir;
}

function run(cwd: string, tmp: string = scratch()): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: { ...gitFreeEnv(), VELOQ_MERGE_LINT_REPO: REPO, TMPDIR: tmp },
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

it('passes a tree with no warnings', () => {
  const root = fixture({ 'a.js': CLEAN });

  expect(run(root).status).toBe(0);
});

it('ignores an unstaged file the merge never touched', () => {
  const root = fixture({ 'a.js': CLEAN });
  write(root, { 'other.js': WARNING });

  const { status, output } = run(root);

  expect(status).toBe(0);
  expect(output).not.toContain('other.js');
});

it('counts the index, not the disk, for a file edited again after staging', () => {
  const root = fixture({ 'a.js': CLEAN });
  write(root, { 'a.js': WARNING });

  expect(run(root).status).toBe(0);
});

it('fails a merge whose own tree carries a warning', () => {
  const root = fixture({ 'a.js': CLEAN }, { 'b.js': WARNING });

  expect(run(root).status).not.toBe(0);
});

it('refuses a merge that raises the ceiling alongside the warning that needs it', () => {
  const root = fixture(
    { 'a.js': CLEAN },
    {
      'package.json': packageJson('eslint . --no-warn-ignored --max-warnings 1'),
      'b.js': WARNING,
    }
  );

  const { status, output } = run(root);

  expect(status).not.toBe(0);
  expect(output).toContain('--max-warnings 0');
});

it('refuses a merged lint script that drops the flag, which leaves eslint unbounded', () => {
  const root = fixture({ 'a.js': CLEAN }, { 'package.json': packageJson('eslint .') });

  expect(run(root).status).not.toBe(0);
});

it('refuses a second --max-warnings beside the zero', () => {
  const root = fixture(
    { 'a.js': CLEAN },
    { 'package.json': packageJson(`${LINT_ZERO} --max-warnings 5`) }
  );

  expect(run(root).status).not.toBe(0);
});

it('accepts the zero with the cache flags after it', () => {
  const root = fixture(
    { 'a.js': CLEAN },
    { 'package.json': packageJson(`${LINT_ZERO} --cache --cache-strategy content`) }
  );

  expect(run(root).status).toBe(0);
});

describe('the content cache', () => {
  const cacheFile = (root: string): string =>
    execFileSync('git', ['rev-parse', '--git-path', 'veloq-merge-lint.cache'], {
      cwd: root,
      encoding: 'utf8',
      env: gitFreeEnv(),
    }).trim();

  const cachePath = (root: string): string => join(root, cacheFile(root));

  it('writes a content cache with an entry per linted file', () => {
    const root = fixture({ 'a.js': CLEAN, 'b.js': CLEAN });

    expect(run(root).status).toBe(0);

    const cached = readFileSync(cachePath(root), 'utf8');
    expect(cached).toContain('/a.js');
    expect(cached).toContain('/b.js');
  });

  it('fails a warning committed after a clean run, for a changed file', () => {
    const root = fixture({ 'a.js': CLEAN });
    expect(run(root).status).toBe(0);

    write(root, { 'a.js': WARNING });
    git(root, 'add', 'a.js');

    expect(run(root).status).not.toBe(0);
  });

  it('still fails a warning in a file the second run reads from the cache', () => {
    const root = fixture({ 'a.js': CLEAN }, { 'b.js': WARNING });
    expect(run(root).status).not.toBe(0);

    expect(run(root).status).not.toBe(0);
  });

  it('does not lint a file removed from the index between runs', () => {
    const root = fixture({ 'a.js': CLEAN, 'b.js': WARNING });
    expect(run(root).status).not.toBe(0);

    git(root, 'rm', '-q', '-f', 'b.js');

    expect(run(root).status).toBe(0);
  });
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
