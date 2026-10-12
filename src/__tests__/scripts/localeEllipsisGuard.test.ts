/**
 * Scenario: locale copy wrote the ellipsis both as three full stops and as the
 * one character, and a line that added its own dots to a string already ending
 * in them printed six.
 *
 * Expected behaviour: the guard fails on three full stops in any locale value,
 * nested or not, and names the file and the key. The single character passes,
 * and so do three full stops outside the locale bundles.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-locale-ellipsis.mjs');

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
  const root = mkdtempSync(join(tmpdir(), 'locale-ellipsis-'));
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

it('fails on three full stops in a nested locale value and names the key', () => {
  const root = fixture({
    'src/i18n/locales/xx.json': JSON.stringify({
      kiln: { firing: 'Firing the glaze…', cooling: { slow: 'Cooling the kiln...' } },
    }),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/i18n/locales/xx.json');
  expect(output).toContain('kiln.cooling.slow');
  expect(output).not.toContain('kiln.firing');
});

it('fails on three full stops before a placeholder', () => {
  const root = fixture({
    'src/i18n/locales/yy.json': JSON.stringify({ kiln: { heat: 'Heating... {{degrees}}' } }),
  });

  expect(runGuard(root).status).toBe(1);
});

it('passes the single character and three full stops outside the locales', () => {
  const root = fixture({
    'src/i18n/locales/xx.json': JSON.stringify({ kiln: { firing: 'Firing the glaze…' } }),
    'src/kiln/notes.ts': 'const spread = [...glazes];\n',
  });

  const { status } = runGuard(root);

  expect(status).toBe(0);
});
