/**
 * Scenario: every engine function was written twice, once in its delegate and
 * once as a one-line member on the client that hands `this` to it, so a new
 * export grew a second door and the client grew by one line each time.
 *
 * Expected behaviour: the guard fails a client member whose whole body is a
 * call into a delegate with `this`, in any of the arrow shapes, unless the
 * baseline still lists it; it fails a baseline entry that is no longer a
 * forward, so the list only shrinks; and it leaves a real method alone.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-engine-client-forwards.mjs');
const CLIENT = 'modules/veloqrs/src/EngineClient.ts';
const BASELINE = 'scripts/engine-client-forwards-baseline.json';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(members: string[], baseline?: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'engine-client-forwards-'));
  roots.push(root);
  const files: Record<string, string> = {
    [CLIENT]: [
      "import * as kiteDelegates from './delegates/kites';",
      'export class EngineClient {',
      '  private engine: unknown = null;',
      ...members.map((line) => `  ${line}`),
      '}',
    ].join('\n'),
  };
  if (baseline) files[BASELINE] = JSON.stringify({ forwards: baseline }, null, 2);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function runGuard(root: string): { status: number | null; output: string } {
  const run = spawnSync('node', [SCRIPT, '--root', root], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

it('fails a member whose body is a delegate call with this', () => {
  const run = runGuard(fixture(['x = (): number => kiteDelegates.x(this);']));
  expect(run.status).toBe(1);
  expect(run.output).toContain('x');
});

it('fails a forward with arguments, a block body and a renamed target', () => {
  const run = runGuard(
    fixture([
      'lift = (id: string, metres: number): boolean => kiteDelegates.lift(this, id, metres);',
      'spool = (id: string): void => {',
      '  kiteDelegates.spool(this, id);',
      '};',
      'reel = (): string[] => {',
      '  return kiteDelegates.winch(this);',
      '};',
    ])
  );
  expect(run.status).toBe(1);
  expect(run.output).toContain('lift');
  expect(run.output).toContain('spool');
  expect(run.output).toContain('reel');
});

it('passes a real method and a member that does more than forward', () => {
  const run = runGuard(
    fixture([
      'get ready(): boolean { return this.engine !== null; }',
      'tether = (id: string): number => kiteDelegates.tether(this, id) + 1;',
      'launch(): void { this.engine = {}; }',
    ])
  );
  expect(run.status).toBe(0);
});

it('passes a forward the baseline still lists', () => {
  const run = runGuard(fixture(['x = (): number => kiteDelegates.x(this);'], ['x']));
  expect(run.status).toBe(0);
});

it('fails a baseline entry that is no longer a forward', () => {
  const run = runGuard(fixture(['x = (): number => kiteDelegates.x(this);'], ['x', 'gone']));
  expect(run.status).toBe(1);
  expect(run.output).toContain('gone');
});

it('fails when the client cannot be read', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-client-forwards-'));
  roots.push(root);
  expect(runGuard(root).status).toBe(1);
});
