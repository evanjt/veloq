/**
 * Scenario: a directory behind a tsconfig path alias is deleted and the alias
 * stays, so it still reads as a real location.
 *
 * Expected behaviour: the guard fails an alias whose target holds no tracked
 * file, and accepts directories, wildcard targets, files with a source
 * extension and index files.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-tsconfig-paths.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(paths: Record<string, string[]>, files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'tsconfig-paths-'));
  roots.push(root);
  const all: Record<string, string> = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths } }),
  };
  for (const file of files) all[file] = 'export {};\n';
  for (const [path, contents] of Object.entries(all)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('fails an alias whose directory holds nothing tracked', () => {
  const root = fixture({ '@/*': ['src/*'], '@/gone': ['src/gone'], '@/theme': ['src/theme'] }, [
    'src/theme/colors.ts',
  ]);

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('@/gone -> src/gone');
  expect(output).not.toContain('@/theme');
  expect(output).not.toContain('@/*');
});

it('fails every missing target of one alias', () => {
  const root = fixture({ '@/x': ['src/one', 'src/two'] }, ['src/two/a.ts']);

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('@/x -> src/one');
  expect(output).not.toContain('src/two');
});

it('accepts a directory, a wildcard, a file with an extension and an index file', () => {
  const root = fixture(
    {
      '@/*': ['src/*'],
      '@/dir': ['src/dir'],
      '@/file': ['src/file'],
      '@/barrel': ['./src/barrel/'],
      '@/glob': ['src/glob/*'],
    },
    ['src/dir/a.ts', 'src/file.tsx', 'src/barrel/index.ts', 'src/glob/b.ts']
  );

  expect(runGuard(root).status).toBe(0);
});

it('accepts a config with no paths', () => {
  expect(runGuard(fixture({}, ['src/a.ts'])).status).toBe(0);
});
