/**
 * Scenario: the expansion latch set by a reset is released by the GPS sync
 * reaching a terminal state.
 * Expected behaviour: every way the sync can stop releases it, not only a
 * completed pass, or the Local Data Range slider stays locked for the session.
 */

import { syncSettledForExpansion } from '@/shared/app/expansionLock';

describe('syncSettledForExpansion', () => {
  it('settles on a completed pass', () => {
    expect(syncSettledForExpansion('complete', 12)).toBe(true);
  });

  it('settles on a failed pass', () => {
    expect(syncSettledForExpansion('error', 12)).toBe(true);
  });

  it('settles when there is nothing to sync, since no pass will ever run', () => {
    expect(syncSettledForExpansion('idle', 0)).toBe(true);
  });

  it('does not settle while a pass is running', () => {
    for (const status of ['fetching', 'processing', 'computing'] as const) {
      expect(syncSettledForExpansion(status, 12)).toBe(false);
    }
  });

  it('does not settle before the activities are loaded', () => {
    expect(syncSettledForExpansion('idle', null)).toBe(false);
  });

  it('does not settle on an idle sync that has activities to run against', () => {
    expect(syncSettledForExpansion('idle', 12)).toBe(false);
  });
});
