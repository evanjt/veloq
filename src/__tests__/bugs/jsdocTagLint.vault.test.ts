/**
 * Scenario: style.md allows no JSDoc in TypeScript, and 145 tags had collected
 * in 28 files with nothing in the gates to refuse the next one.
 *
 * Expected behaviour: the guard reads every tracked TypeScript source out of
 * the index, names each tag line, and leaves a plain description comment, a
 * generated file and a string that merely contains the text alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-jsdoc-tags.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jsdoc-tags-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const block = (...lines: string[]) => ['/**', ...lines.map((l) => ` * ${l}`), ' */', ''].join('\n');

it.each([
  '@param meters - Distance',
  '@returns The label',
  '@example',
  '@throws Error',
  '@fileoverview Helpers',
])('fails on %s in a block comment', (tag) => {
  const root = fixture({
    'src/shared/probe.ts': `${block('Describes the probe.', tag)}export const a = 1;\n`,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/shared/probe.ts:3');
});

it('fails on an indented tag inside a class or hook body', () => {
  const root = fixture({
    'src/features/probe/useProbe.tsx':
      'export function useProbe() {\n  /**\n   * @returns the value\n   */\n  return 1;\n}\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/probe/useProbe.tsx:3');
});

it('names every tag line, not only the first', () => {
  const root = fixture({
    'modules/veloqrs/src/probe.ts': `${block('@param a - one', '@param b - two')}export const a = 1;\n`,
  });

  const { output } = runGuard(root);

  expect(output).toContain('modules/veloqrs/src/probe.ts:2');
  expect(output).toContain('modules/veloqrs/src/probe.ts:3');
});

it('passes a description comment with no tag', () => {
  const root = fixture({
    'src/shared/probe.ts': `${block('Distance in metres, rounded to the nearest whole.')}export const a = 1;\n`,
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes an at sign in prose and in a string', () => {
  const root = fixture({
    'src/shared/probe.ts':
      "// Mail support@example.com about the @param naming.\nexport const a = '/** @param x */';\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('skips generated bindings, which carry the crate docstrings', () => {
  const root = fixture({
    'modules/veloqrs/src/generated/veloqrs.ts': `${block('@deprecated Use the other.', '@param x - y')}export const a = 1;\n`,
  });

  expect(runGuard(root).status).toBe(0);
});

it('ignores an untracked file', () => {
  const root = fixture({ 'src/kept.ts': 'export const a = 1;\n' });
  writeFileSync(join(root, 'src/scratch.ts'), block('@param x - y'));

  expect(runGuard(root).status).toBe(0);
});
