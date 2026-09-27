/**
 * Scenario: a record is built from nullable input by setting every absent
 * field to a literal `undefined`. `tsconfig.json` turns on
 * `exactOptionalPropertyTypes`, so plain `tsc` refuses that shape wherever it
 * is written, and `present` is how a record built from nullable input leaves
 * an absent field out instead.
 *
 * Expected behaviour: `present` drops the keys whose value is `undefined` and
 * keeps every other value, falsy and null included.
 */

import { present } from 'veloqrs/src/delegates/optional';

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
