/**
 * Scenario: the engine's settings read throws, for example a busy or locked database.
 *
 * Expected behaviour: the delegate lets the failure reach the caller instead of answering
 * `undefined`, which a caller reads as a key that was never written.
 */

import { getSetting } from '../../../modules/veloqrs/src/delegates/settings';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function host(ready: boolean, read: (key: string) => string | undefined): DelegateHost {
  return {
    ready,
    timed: <T>(_name: string, run: () => T) => run(),
    engine: { settings: () => ({ getSetting: read }) },
  } as unknown as DelegateHost;
}

describe('getSetting', () => {
  it('rethrows a failed read', () => {
    const failure = new Error('database is locked');
    const h = host(true, () => {
      throw failure;
    });

    expect(() => getSetting(h, '__athlete_id')).toThrow(failure);
  });

  it('answers undefined for an absent key', () => {
    expect(
      getSetting(
        host(true, () => undefined),
        '__athlete_id'
      )
    ).toBeUndefined();
  });

  it('answers undefined when the engine is not ready', () => {
    const read = jest.fn();
    expect(getSetting(host(false, read), '__athlete_id')).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns a stored value', () => {
    expect(
      getSetting(
        host(true, () => '42'),
        '__athlete_id'
      )
    ).toBe('42');
  });
});
