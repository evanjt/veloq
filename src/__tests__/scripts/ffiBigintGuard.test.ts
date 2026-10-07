/**
 * Scenario: a record the engine hands back is persisted whole, through
 * `JSON.stringify`, and a field lifted as `bigint` makes it throw `Do not know
 * how to serialize a BigInt`. `tsc` cannot see it, so the first caller to
 * persist one fails in release on every launch. A parameter or a return lifted
 * as `bigint` puts the same value on the other side of a hand conversion at
 * every call site, so one fact crosses two ways.
 *
 * Expected behaviour: the guard fails a generated record field, parameter or
 * return lifted as `bigint`, and leaves an `f64` and the callback vtable's
 * handle alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-ffi-bigint.mjs');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(generated: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'ffi-bigint-'));
  roots.push(root);
  mkdirSync(join(root, 'modules/veloqrs/src/generated'), { recursive: true });
  writeFileSync(join(root, 'modules/veloqrs/src/generated/veloqrs.ts'), generated);
  const args = [SCRIPT, '--root', root];
  try {
    const output = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('fails a record field lifted as bigint', () => {
  const { status, output } = runGuard(
    ['export type PeriodStats = {', '  totalDuration: /*i64*/ bigint;', '};'].join('\n')
  );

  expect(status).toBe(1);
  expect(output).toContain('veloqrs.ts:2  totalDuration: /*i64*/ bigint');
});

it('fails an optional one too', () => {
  expect(runGuard('export type R = {\n  createdAt?: /*u64*/ bigint;\n};\n').status).toBe(1);
});

it.each([
  ['an array', '  versions: Array<bigint>;'],
  ['a map', '  counts: Map<string, bigint>;'],
  ['a union with undefined', '  at: /*i64*/ bigint | undefined;'],
  ['an optional array', '  versions?: Array</*i64*/ bigint>;'],
])('fails %s of bigint', (_shape, field) => {
  expect(runGuard(`export type R = {\n${field}\n};\n`).status).toBe(1);
});

it.each([
  ['a parameter', 'export function cancelRun(run: bigint): boolean {'],
  ['a parameter on its own line', '    startTs: bigint,'],
  ['an array parameter', '    weekStarts: Array<bigint>,'],
  ['an optional parameter', '    pairedEventId: bigint | undefined,'],
  ['a return', '  streamStoreBytes(): bigint /*throws*/ {'],
  ['a return after a throws marker', '  streamRetentionDays() /*throws*/ : bigint;'],
  ['a return on its own line', '): bigint {'],
  ['an async return', '  getCacheSize(asyncOpts_?: { signal: AbortSignal }): Promise<bigint>;'],
])('fails %s lifted as bigint', (_shape, line) => {
  const { status, output } = runGuard(`export interface Thing {\n${line}\n}\n`);
  expect(status).toBe(1);
  expect(output).toContain('veloqrs.ts:2');
});

it('leaves f64 fields, parameters and returns alone', () => {
  const { status } = runGuard(
    [
      'export type R = {',
      '  versions: Array<number>;',
      '  totalDuration: /*f64*/ number;',
      '};',
      'export function f(',
      '  run: /*f64*/ number,',
      '): /*f64*/ number;',
      '  getCacheSize(asyncOpts_?: { signal: AbortSignal }): Promise</*f64*/ number>;',
    ].join('\n')
  );
  expect(status).toBe(0);
});

it('leaves the callback vtable handle and comments alone', () => {
  const { status } = runGuard(
    [
      'const vtable = {',
      '  sync_progress: (uniffiHandle: bigint) => {',
      '  },',
      '  backfill_phase: (uniffiHandle: bigint, phase: Uint8Array) => {',
      '  },',
      '};',
      '// FfiConverter for bigint | undefined',
      ' * a field lifted as bigint throws the first time a caller stringifies it',
    ].join('\n')
  );
  expect(status).toBe(0);
});
