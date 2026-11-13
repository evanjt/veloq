/**
 * Scenario: every app open and every pull raised the sync pill for the census
 * and profile steps of a check that finished in a second.
 * Expected behaviour: a sync is quiet until it passes the grace period or a
 * step reports an item count, and an idle or failed sync draws nothing.
 */

import { SyncState, SyncStep } from 'veloqrs';

import { SYNC_PILL_GRACE_MS, syncPillVisible } from '@/shared/ui/syncPillVisible';

const census = { state: SyncState.Syncing, step: SyncStep.Census };

test('a census step one second in stays hidden', () => {
  expect(syncPillVisible(census, 1000)).toBe(false);
});

test('the same step shows once the grace period has passed', () => {
  expect(syncPillVisible(census, SYNC_PILL_GRACE_MS - 1)).toBe(false);
  expect(syncPillVisible(census, SYNC_PILL_GRACE_MS)).toBe(true);
});

test('a step with an item count shows at once', () => {
  const remaining = {
    state: SyncState.Syncing,
    step: SyncStep.RemainingActivities,
    stepItemsDone: 0,
    stepItemsTotal: 40,
  };
  expect(syncPillVisible(remaining, 0)).toBe(true);
});

test('a step with a zero count is still a quiet one', () => {
  expect(syncPillVisible({ ...census, stepItemsDone: 0, stepItemsTotal: 0 }, 10)).toBe(false);
});

test.each([[SyncState.Idle], [SyncState.Paused], [SyncState.AuthExpired]])(
  '%s draws nothing',
  (state) => {
    expect(syncPillVisible({ state, stepItemsTotal: 40 }, 99_999)).toBe(false);
    expect(syncPillVisible(null, 99_999)).toBe(false);
  }
);
