/**
 * Scenario: the device is on en-US and the app on ja, and a date formatted with no locale
 * renders English month names.
 *
 * Expected behaviour: the guard fails a date call with no locale, `undefined` or a fixed
 * 'en-US', names file and line, and accepts a call that passes a locale, a test file and the
 * debug screens.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-device-locale-dates.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'device-locale-'));
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

const OWNED = 'const a = d.toLocaleDateString(appLocale, { month: "short" });\n';

it.each([
  ['no locale', 'd.toLocaleDateString()'],
  ['undefined', 'd.toLocaleTimeString(undefined, {})'],
  ['a fixed en-US', "new Intl.DateTimeFormat('en-US').format(d)"],
  ['a bare toLocaleString', 'd.toLocaleString( )'],
])('fails a date formatted with %s, naming file and line', (_label, call) => {
  const root = fixture({
    'src/ok.ts': OWNED,
    'src/features/kayak.ts': `const a = 1;\nconst b = ${call};\n`,
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/kayak.ts:2');
  expect(output).not.toContain('src/ok.ts');
});

it('passes a call that names the app locale, a test file and the debug screens', () => {
  const root = fixture({
    'src/ok.ts': OWNED,
    'src/__tests__/a.test.ts': 'd.toLocaleDateString();\n',
    'src/app/debug.tsx': 'd.toLocaleString();\n',
    'src/features/routes/components/SyncDebugSection.tsx': 'd.toLocaleTimeString();\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('refuses a tree with no sources rather than passing it', () => {
  const root = fixture({ 'README.txt': 'empty\n' });

  expect(runGuard(root).status).not.toBe(0);
});
