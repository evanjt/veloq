/**
 * Scenario: the delegates build engine records by setting every absent field
 * to a literal `undefined` and asserting the result as the `Ffi*` type. The
 * assertion says the shape is right, so a Rust record that gains or renames a
 * field keeps compiling here and the value reaches the screen as a blank.
 *
 * Expected behaviour: a delegate builds the record it claims to build. With
 * `exactOptionalPropertyTypes` an absent optional field is omitted, not filled
 * with `undefined`, and the boundary reports nothing.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { present } from 'veloqrs/src/delegates/optional';

const ROOT = join(__dirname, '../../..');

/** Every error the compiler reports under the engine module, one per line. */
function boundaryErrors(): string[] {
  let report: string;
  try {
    report = execFileSync('npx', ['tsc', '--noEmit', '--exactOptionalPropertyTypes'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // tsc exits non-zero while the app code outside the boundary still
    // reports, which is a separate item. Its stdout is the report either way.
    report = (error as { stdout?: string }).stdout ?? '';
  }
  return report.split('\n').filter((line) => line.startsWith('modules/veloqrs/src'));
}

describe('the engine boundary is exact about its optional fields', () => {
  it('reports nothing under modules/veloqrs/src', () => {
    expect(boundaryErrors()).toEqual([]);
  });
});

describe('present', () => {
  it('drops an absent field rather than carrying the key', () => {
    const record = present({ date: '2026-09-15', ctl: undefined });

    expect('ctl' in record).toBe(false);
    expect(record).toEqual({ date: '2026-09-15' });
  });

  it('keeps a falsy value, which is a value', () => {
    expect(present({ ctl: 0, name: '', race: false })).toEqual({ ctl: 0, name: '', race: false });
  });

  it('keeps null, which the FFI converters reject rather than read as absent', () => {
    const record = present({ raw: null });

    expect('raw' in record).toBe(true);
  });

  it('leaves a nested record alone, absent fields and all', () => {
    const nested = { inner: { ctl: undefined } };

    expect(present(nested).inner).toEqual({ ctl: undefined });
  });

  it('reads an empty record as an empty record', () => {
    expect(present({})).toEqual({});
  });
});
