/**
 * Scenario: week and today windows are built from the device clock, then
 * compared against `activity_metrics.date`, which is a wall clock stamped as
 * UTC. Expected behaviour: the bounds carry the athlete's local calendar
 * whatever the device offset, so an evening ride counts in the week it
 * happened and the previous week does not overlap the current one.
 */
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

const mockRouteMatching = jest.fn(() => false);
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => mockRouteMatching(),
}));

const withTz = <T>(offset: number, run: () => T): T => atUtcOffset(offset, run);

const utcMidnight = (ts: number) => new Date(Number(ts) * 1000).toISOString();

describe('insights params section switch', () => {
  it('asks for sections only with route matching on', () => {
    mockRouteMatching.mockReturnValue(false);
    expect(buildInsightsParams().includeSections).toBe(false);
    mockRouteMatching.mockReturnValue(true);
    expect(buildInsightsParams().includeSections).toBe(true);
    mockRouteMatching.mockReturnValue(false);
  });
});

describe('week window timebase', () => {
  it('stamps local midnight as UTC midnight', () => {
    for (const tz of [10, -7, 0]) {
      const seconds = withTz(tz, () => {
        const midnight = new Date(2026, 7, 24);
        return localWallClockToEpochSeconds(midnight);
      });
      expect(new Date(seconds * 1000).toISOString()).toBe('2026-08-24T00:00:00.000Z');
    }
  });

  it('keeps the athlete calendar date for an evening ride in UTC+10', () => {
    const evening = withTz(10, () =>
      localWallClockToEpochSeconds(new Date(2026, 7, 26, 19, 30, 0))
    );
    expect(new Date(evening * 1000).toISOString()).toBe('2026-08-26T19:30:00.000Z');
  });

  it.each([10, -7])('starts the week at local Monday midnight at UTC offset %d', (tz) => {
    const params = withTz(tz, () => buildInsightsParams());
    expect(utcMidnight(params.currentStart)).toMatch(/T00:00:00\.000Z$/);
    expect(utcMidnight(params.todayStart)).toMatch(/T00:00:00\.000Z$/);
    expect(new Date(Number(params.currentStart) * 1000).getUTCDay()).toBe(1);
  });

  it('does not let the previous week touch the current one', () => {
    const params = withTz(10, () => buildInsightsParams());
    expect(params.prevEnd).toBeLessThan(params.currentStart);
    expect(Number(params.currentStart) - Number(params.prevStart)).toBe(7 * 86400);
  });

  describe('previous window ends at the same point of the week as now', () => {
    const windowsAt = (now: Date) => {
      jest.useFakeTimers().setSystemTime(now);
      try {
        return buildInsightsParams();
      } finally {
        jest.useRealTimers();
      }
    };

    it.each([
      ['Monday 09:00', new Date(2026, 8, 28, 9, 0, 0), 9 * 3600],
      ['Wednesday 14:30', new Date(2026, 8, 30, 14, 30, 0), 2 * 86400 + 14.5 * 3600],
      ['Sunday 23:00', new Date(2026, 9, 4, 23, 0, 0), 6 * 86400 + 23 * 3600],
    ])('at %s the two windows have equal length', (_label, now, elapsed) => {
      const params = windowsAt(now);
      expect(Number(params.currentEnd) - Number(params.currentStart)).toBe(elapsed);
      expect(Number(params.prevEnd) - Number(params.prevStart)).toBe(elapsed);
    });

    it('a week under an hour old compares under an hour, not a whole week', () => {
      const params = windowsAt(new Date(2026, 8, 28, 0, 30, 0));
      expect(Number(params.prevEnd) - Number(params.prevStart)).toBe(1800);
    });
  });
});
