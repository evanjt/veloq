/**
 * Scenario: the lint gates read the warning ceiling from the tree they judged,
 * so a commit that raised it beside a matching new warning passed them all.
 * Expected behaviour: the lint script passes `--max-warnings 0` and nothing
 * else, checked at commit on the staged package.json, and a raise, a missing
 * flag or a second flag is refused.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-zero-warnings.mjs');

function check(lint: string | undefined): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lint-zero-'));
  try {
    const file = join(dir, 'package.json');
    writeFileSync(file, JSON.stringify({ scripts: lint === undefined ? {} : { lint } }));
    const r = spawnSync('node', [SCRIPT, file], { encoding: 'utf8', env: gitFreeEnv() });
    return { status: r.status ?? -1, output: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('passes a lint script at zero, with flags after it', () => {
  expect(check('eslint . --max-warnings 0 --cache').status).toBe(0);
});

it('refuses a raised ceiling and names it', () => {
  const { status, output } = check('eslint . --max-warnings 3');
  expect(status).toBe(1);
  expect(output).toContain('--max-warnings 3');
});

it('refuses a lint script with no ceiling at all', () => {
  expect(check('eslint .').status).toBe(1);
  expect(check(undefined).status).toBe(1);
});

it('refuses a second flag beside the zero', () => {
  expect(check('eslint . --max-warnings 0 --max-warnings=5').status).toBe(1);
});

/**
 * Scenario: the content cache sat in node_modules/.cache/eslint, a directory
 * ESLint names each file in by a hash of the working directory. Every worktree
 * links its node_modules to the main checkout's, so each new worktree left a
 * cache file there for good: 33 files and 33 MB on 2026-09-30.
 * Expected behaviour: the cache sits in the checkout it describes, so it goes
 * when the checkout goes, and a location in node_modules or outside the
 * checkout is refused.
 */
describe('the content cache', () => {
  const ZERO = 'eslint . --max-warnings 0 --cache --cache-strategy content';

  it.each(['--cache-location .eslintcache', '--cache-location=.eslintcache', ''])(
    'passes a cache inside the checkout: "%s"',
    (location) => {
      expect(check(`${ZERO} ${location}`.trim()).status).toBe(0);
    }
  );

  it.each([
    '--cache-location node_modules/.cache/eslint/',
    '--cache-location=node_modules/.cache/eslint',
    '--cache-location ./node_modules/.eslintcache',
    '--cache-location /tmp/eslintcache',
    '--cache-location ../eslintcache',
  ])('refuses a cache every worktree shares, or one outside the checkout: "%s"', (location) => {
    const { status, output } = check(`${ZERO} ${location}`);
    expect(status).toBe(1);
    expect(output).toContain('--cache-location');
  });
});

it('reads the package.json the commit records, not the one on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-zero-staged-'));
  try {
    runGit(['init', '-q'], root);
    const file = join(root, 'package.json');
    writeFileSync(file, JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 5' } }));
    runGit(['add', 'package.json'], root);
    writeFileSync(file, JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 0' } }));

    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: gitFreeEnv() });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--max-warnings 5');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Scenario: the staged package.json read failed and the check fell back to the
 * disk copy, which is not the tree the commit is making. An index naming a blob
 * the object store no longer held judged the working copy, at zero, while the
 * commit recorded a raised ceiling.
 *
 * Expected behaviour: in a checkout a failed read of the staged package.json
 * fails the check and names the file. Only a directory that is not a checkout
 * reads the disk.
 */
describe('a staged package.json that cannot be read', () => {
  it('fails rather than judging the copy on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'lint-zero-unreadable-'));
    try {
      runGit(['init', '-q'], root);
      const file = join(root, 'package.json');
      writeFileSync(file, JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 5' } }));
      runGit(['add', 'package.json'], root);
      const sha = runGit(['rev-parse', ':package.json'], root).trim();
      rmSync(join(root, '.git', 'objects', sha.slice(0, 2), sha.slice(2)));
      writeFileSync(file, JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 0' } }));

      const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: gitFreeEnv() });

      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('package.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still reads the disk in a directory that is not a checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'lint-zero-bare-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { lint: 'eslint . --max-warnings 0' } })
      );

      const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', env: gitFreeEnv() });

      expect(r.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
