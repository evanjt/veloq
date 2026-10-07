/**
 * Scenario: a file imports something for its tests above its production code,
 * and a later production function takes the engine write lock.
 *
 * Expected behaviour: the guard counts that take. Only the test item itself is
 * left out of the count, never the rest of the file.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GUARD = join(__dirname, '../../../scripts/lint-engine-write-lock.mjs');
const REL = 'modules/veloqrs/rust/veloqrs/src/objects/a.rs';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const countFor = (source: string): number => {
  const root = mkdtempSync(join(tmpdir(), 'write-lock-'));
  roots.push(root);
  mkdirSync(dirname(join(root, REL)), { recursive: true });
  writeFileSync(join(root, REL), source);
  const baseline = join(root, 'baseline.json');
  writeFileSync(baseline, '{}');
  const run = spawnSync('node', [GUARD, '--root', root, '--baseline', baseline, '--write'], {
    encoding: 'utf8',
  });
  expect(run.status).toBe(0);
  const written = JSON.parse(readFileSync(baseline, 'utf8'));
  return written[REL] ?? 0;
};

describe('engine write-lock guard and test-only items', () => {
  it('counts a production take after a test-only import', () => {
    const source = [
      '#[cfg(test)]',
      'use crate::governor;',
      'pub fn go() { with_engine(|e| e.go()); }',
      '',
    ].join('\n');
    expect(countFor(source)).toBe(1);
  });

  it('counts a production take after a test-only function with braces in strings', () => {
    const source = [
      '#[cfg(test)]',
      'fn seed() { let s = "}{"; let c = \'}\'; with_engine(|e| e.seed()); }',
      'pub fn go() { with_persistent_engine_for(id, |e| e.go()); }',
      '',
    ].join('\n');
    expect(countFor(source)).toBe(1);
  });

  it('counts a production take after a test module and before another', () => {
    const source = [
      'pub fn a() { with_engine(|e| e.a()); }',
      '#[cfg(test)]',
      'mod tests { fn t() { with_engine(|e| { if x { y } }); } }',
      'pub fn b() { with_engine(|e| e.b()); }',
      '#[cfg(test)]',
      'mod more { fn t() { with_engine(|e| e.t()); } }',
      '',
    ].join('\n');
    expect(countFor(source)).toBe(2);
  });

  it('cuts a test module holding a raw string with braces and quotes', () => {
    const source = [
      'pub fn a() { with_engine(|e| e.a()); }',
      '#[cfg(test)]',
      'mod tests { fn t() { let s = r#"{"k":"v"}"#; with_engine(|e| e.t()); } }',
      '',
    ].join('\n');
    expect(countFor(source)).toBe(1);
  });

  it('counts a try take that never waits', () => {
    expect(countFor('pub fn a() { try_with_persistent_engine_for(id, |e| e.a()); }\n')).toBe(1);
  });

  it('counts nothing in a file whose only takes are test items', () => {
    expect(countFor('#[cfg(test)]\nmod tests { fn t() { with_engine(|e| e.t()); } }\n')).toBe(0);
  });
});
