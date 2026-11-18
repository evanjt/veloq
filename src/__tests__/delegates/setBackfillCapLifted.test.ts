/**
 * Scenario: the Developer Dashboard's switch lifts the backfill's daily cap by
 * calling the sync delegate. The delegate is the one owner of the call on
 * SyncManager, so a missing export or a call on the wrong object fails here.
 *
 * Expected behaviour: the delegate calls SyncManager.setBackfillCapLifted once
 * with the flag, and a refusal from the engine reaches the caller.
 */
import * as sync from '../../../modules/veloqrs/src/delegates/sync';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function fixture(setBackfillCapLifted: jest.Mock) {
  const host = {
    ready: true,
    engine: { sync: () => ({ setBackfillCapLifted }) },
    write: (_name: string, run: () => void) => run(),
  } as unknown as DelegateHost;
  return host;
}

describe('setBackfillCapLifted', () => {
  it('passes the flag to SyncManager once', () => {
    const setBackfillCapLifted = jest.fn();

    sync.setBackfillCapLifted(fixture(setBackfillCapLifted), true);

    expect(setBackfillCapLifted).toHaveBeenCalledTimes(1);
    expect(setBackfillCapLifted).toHaveBeenCalledWith(true);
  });

  it('passes the restore through as false', () => {
    const setBackfillCapLifted = jest.fn();

    sync.setBackfillCapLifted(fixture(setBackfillCapLifted), false);

    expect(setBackfillCapLifted).toHaveBeenCalledWith(false);
  });

  it('lets a refusal from the engine reach the caller', () => {
    const setBackfillCapLifted = jest.fn(() => {
      throw new Error('not a personal key');
    });

    expect(() => sync.setBackfillCapLifted(fixture(setBackfillCapLifted), true)).toThrow(
      'not a personal key'
    );
  });
});
