/**
 * Scenario: `VeloqError` is a typed enum the bindings carry across, and the
 * shared reader spells the variants rather than importing them, so a consumer
 * naming a failure does not pull the native binding chain in for a string.
 *
 * Expected behaviour: a failure is read off the tag the binding put there. That
 * the tags are exactly the variants Rust declares is a row of the contract
 * table, so a variant added, renamed or removed fails there rather than falling
 * silently into the fallback message at every call site.
 */

import { engineErrorTag, engineErrorKey } from '@/shared/native/engineError';

describe('reading a failure the engine reported', () => {
  it('names the variant off the tag the binding put there', () => {
    expect(engineErrorTag({ tag: 'NotInitialized' })).toBe('NotInitialized');
    expect(engineErrorTag({ tag: 'Database', inner: { msg: 'disk I/O error' } })).toBe('Database');
  });

  it('answers nothing for a failure that is not the engine', () => {
    expect(engineErrorTag(new Error('Catalogue clear did not finish in time'))).toBeUndefined();
    expect(engineErrorTag('Database')).toBeUndefined();
    expect(engineErrorTag({ tag: 'LockFailed' })).toBeUndefined();
    expect(engineErrorTag(null)).toBeUndefined();
    expect(engineErrorTag({ tag: 'SomethingElse' })).toBeUndefined();
  });

  it('tells the engine not being open from the database failing', () => {
    expect(engineErrorKey({ tag: 'NotInitialized' }, 'alerts.failedToClear')).toBe(
      'engine.failure.notOpen'
    );
    expect(engineErrorKey({ tag: 'Database', inner: { msg: 'x' } }, 'alerts.failedToClear')).toBe(
      'engine.failure.database'
    );
    expect(engineErrorKey({ tag: 'Busy', inner: { msg: 'x' } }, 'alerts.failedToClear')).toBe(
      'engine.failure.busy'
    );
  });

  it('names a refused rename off the tag, so no caller reads the message text', () => {
    expect(engineErrorTag({ tag: 'NameTaken', inner: { name: 'Col' } })).toBe('NameTaken');
  });

  it('leaves a failure of our own on the fallback the caller gave', () => {
    expect(engineErrorKey(new Error('did not finish in time'), 'alerts.failedToClear')).toBe(
      'alerts.failedToClear'
    );
  });
});
