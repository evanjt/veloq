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
