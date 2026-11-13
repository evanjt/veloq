/**
 * Expected behaviour: the guard fails a bare `{ lat: number; lng: number }` point
 * declared outside `coords.ts`, inline or as an interface, and leaves records
 * with other fields, tests and the declaring file alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-point-shape.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'point-shape-'));
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

const CLEAN = {
  'modules/veloqrs/src/coords.ts': 'export interface LatLngShort { lat: number; lng: number }\n',
};

it('fails an inline point shape', () => {
  const root = fixture({
    ...CLEAN,
    'src/a.ts': 'export const f = (p: { lat: number; lng: number }[]) => p;\n',
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/a.ts:1');
});

it('fails a multi-line interface and the reversed field order', () => {
  const root = fixture({
    ...CLEAN,
    'src/b.ts': 'export interface Centre {\n  lat: number;\n  lng: number;\n}\n',
    'src/c.ts': 'type P = { lng: number, lat: number };\n',
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/b.ts:1');
  expect(output).toContain('src/c.ts:1');
});

it('passes records with other fields, tests and the declaring file', () => {
  const root = fixture({
    ...CLEAN,
    'src/d.ts': 'export interface C { lat: number; lng: number; name: string }\n',
    'src/__tests__/e.ts': 'const p: { lat: number; lng: number } = { lat: 1, lng: 2 };\n',
  });
  expect(runGuard(root).status).toBe(0);
});
