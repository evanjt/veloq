/**
 * Scenario: a non-screen module sits under src/app, so expo-router registers
 * it as a route with no component.
 *
 * Expected behaviour: the guard fails a route file with no default export, and
 * accepts default exports, `+`-prefixed convention files and non-code files.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-route-default-exports.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'route-exports-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
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

const SCREEN = 'export default function Screen() { return null; }\n';

it('fails a module with only named exports', () => {
  const root = fixture({
    'src/app/about.tsx': SCREEN,
    'src/app/bootstrap.ts': 'export function start() {}\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/app/bootstrap.ts');
  expect(output).not.toContain('about.tsx');
});

it('fails a nested route file with no default export', () => {
  const root = fixture({
    'src/app/section/[id].tsx': 'export const x = 1;\n',
    'src/app/about.tsx': SCREEN,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/app/section/[id].tsx');
});

it('accepts default exports, re-exported defaults, convention files and non-code files', () => {
  const root = fixture({
    'src/app/about.tsx': SCREEN,
    'src/app/reexport.tsx': "export { Screen as default } from '@/x';\n",
    'src/app/+native-intent.ts': 'export function redirectSystemPath() {}\n',
    'src/app/notes.json': '{}\n',
  });

  expect(runGuard(root).status).toBe(0);
});
