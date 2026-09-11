/**
 * Scenario: the athlete widens the local range, the engine accepts the window
 * and downloads it over seconds while the SQLite read behind the feed settles
 * in milliseconds.
 * Expected behaviour: every surface named after the download says so for as
 * long as the download runs, and a request the engine never picks up ends in a
 * named state rather than a banner nothing clears.
 */

import {
  IDLE_EXTENDED_FETCH,
  PICKUP_DEADLINE_MS,
  expirePickup,
  isExtendedFetchRunning,
  syncStateChanged,
  windowAccepted,
} from '@/shared/app/extendedFetch';

describe('extendedFetch', () => {
  it('runs from the moment the engine accepts a window', () => {
    const accepted = windowAccepted(IDLE_EXTENDED_FETCH, 1_000);

    expect(accepted.phase).toBe('awaitingPickup');
    expect(isExtendedFetchRunning(accepted)).toBe(true);
  });

  it('keeps running while the engine holds the slot', () => {
    const downloading = syncStateChanged(windowAccepted(IDLE_EXTENDED_FETCH, 1_000), true, 1_010);

    expect(downloading.phase).toBe('downloading');
    expect(isExtendedFetchRunning(downloading)).toBe(true);
  });

  it('stops when the engine lets the slot go', () => {
    const downloading = syncStateChanged(windowAccepted(IDLE_EXTENDED_FETCH, 1_000), true, 1_010);
    const settled = syncStateChanged(downloading, false, 9_000);

    expect(settled.phase).toBe('idle');
    expect(isExtendedFetchRunning(settled)).toBe(false);
  });

  it('ignores a sync holding the slot with no window accepted', () => {
    const launchSync = syncStateChanged(IDLE_EXTENDED_FETCH, true, 1_000);

    expect(launchSync.phase).toBe('idle');
    expect(isExtendedFetchRunning(launchSync)).toBe(false);
  });

  it('does not settle on an idle status read before the engine reports the slot', () => {
    const accepted = windowAccepted(IDLE_EXTENDED_FETCH, 1_000);
    const early = syncStateChanged(accepted, false, 1_005);

    expect(early.phase).toBe('awaitingPickup');
    expect(isExtendedFetchRunning(early)).toBe(true);
  });

  it('expires a pickup the engine never reports, and only that phase', () => {
    const accepted = windowAccepted(IDLE_EXTENDED_FETCH, 1_000);

    expect(expirePickup(accepted, 1_000 + PICKUP_DEADLINE_MS - 1)).toBe(accepted);

    const expired = expirePickup(accepted, 1_000 + PICKUP_DEADLINE_MS);
    expect(expired.phase).toBe('expired');
    expect(isExtendedFetchRunning(expired)).toBe(false);

    const downloading = syncStateChanged(accepted, true, 1_010);
    expect(expirePickup(downloading, 1_000 + PICKUP_DEADLINE_MS * 10)).toBe(downloading);
  });

  it('carries a second window accepted mid-download without restarting the phase', () => {
    const downloading = syncStateChanged(windowAccepted(IDLE_EXTENDED_FETCH, 1_000), true, 1_010);
    const second = windowAccepted(downloading, 5_000);

    expect(second.phase).toBe('downloading');
    expect(second.since).toBe(5_000);
  });
});
