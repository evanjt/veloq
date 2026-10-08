/**
 * Scenario: the device clock is converted into the wall-clock stamps the
 * engine compares against `activity_metrics.date`.
 */
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

const mockRouteMatching = jest.fn(() => false);
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => mockRouteMatching(),
}));

const withTz = <T>(offset: number, run: () => T): T => atUtcOffset(offset, run);

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

  it.each([10, -7])('stamps today at local midnight at UTC offset %d', (tz) => {
    const params = withTz(tz, () => buildInsightsParams());
    expect(new Date(Number(params.todayStart) * 1000).toISOString()).toMatch(/T00:00:00\.000Z$/);
  });
});
