/**
 * Scenario: a restored record names a ride from four years back, so the oldest stored
 * activity is far older than the window the athlete asked the device to hold.
 *
 * Expected behaviour: the sync range is seeded from the engine's held window, not from the
 * oldest stored activity, so launch never starts a download of the span in between.
 */

import { seedSyncRange } from '@/shared/app/syncRangeSeed';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

const stats = (over: Record<string, unknown> = {}) => ({
  oldestDate: Date.UTC(2022, 9, 6) / 1000,
  newestDate: Date.UTC(2026, 9, 5, 12) / 1000,
  activityWindowOldest: '2026-07-08',
  ...over,
});

describe('seedSyncRange', () => {
  it('opens the range at the held window while the oldest stored ride is years older', () => {
    const initialiseRange = jest.fn();
    expect(seedSyncRange(stats() as never, initialiseRange)).toBe(true);
    expect(initialiseRange).toHaveBeenCalledTimes(1);
    expect(initialiseRange.mock.calls[0][0]).toBe('2026-07-08');
    expect(initialiseRange.mock.calls[0][1]).toMatch(/^2026-10-0[5-6]$/);
  });

  it('seeds nothing for an empty library', () => {
    const initialiseRange = jest.fn();
    expect(seedSyncRange(stats({ newestDate: undefined }) as never, initialiseRange)).toBe(false);
    expect(seedSyncRange(undefined, initialiseRange)).toBe(false);
    expect(initialiseRange).not.toHaveBeenCalled();
  });

  it('reads the newest stored day as the wall clock the engine stamped, west of Greenwich', () => {
    const initialiseRange = jest.fn();
    const newestDate = Date.UTC(2026, 10, 5, 2, 0, 0) / 1000;
    atUtcOffset(-8, () => seedSyncRange(stats({ newestDate }) as never, initialiseRange));
    expect(initialiseRange.mock.calls[0][1]).toBe('2026-11-05');
  });

  it('follows a window the athlete widened', () => {
    const initialiseRange = jest.fn();
    seedSyncRange(stats({ activityWindowOldest: '2023-01-01' }) as never, initialiseRange);
    expect(initialiseRange.mock.calls[0][0]).toBe('2023-01-01');
  });
});
