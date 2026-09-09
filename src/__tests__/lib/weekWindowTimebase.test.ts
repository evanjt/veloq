/**
 * Scenario: week and today windows are built from the device clock, then
 * compared against `activity_metrics.date`, which is a wall clock stamped as
 * UTC. Expected behaviour: the bounds carry the athlete's local calendar
 * whatever the device offset, so an evening ride counts in the week it
 * happened and the previous week does not overlap the current one.
 */
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => false,
}));

const withTz = <T>(tz: string, run: () => T): T => {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = original;
  }
};

const utcMidnight = (ts: bigint) => new Date(Number(ts) * 1000).toISOString();

describe('week window timebase', () => {
  it('stamps local midnight as UTC midnight', () => {
    for (const tz of ['Australia/Sydney', 'America/Los_Angeles', 'UTC']) {
      const seconds = withTz(tz, () => {
        const midnight = new Date(2026, 7, 24);
        return localWallClockToEpochSeconds(midnight);
      });
      expect(new Date(seconds * 1000).toISOString()).toBe('2026-08-24T00:00:00.000Z');
    }
  });

  it('keeps the athlete calendar date for an evening ride in UTC+10', () => {
    const evening = withTz('Australia/Sydney', () =>
      localWallClockToEpochSeconds(new Date(2026, 7, 26, 19, 30, 0))
    );
    expect(new Date(evening * 1000).toISOString()).toBe('2026-08-26T19:30:00.000Z');
  });

  it.each(['Australia/Sydney', 'America/Los_Angeles'])(
    'starts the week at local Monday midnight in %s',
    (tz) => {
      const params = withTz(tz, () => buildInsightsParams());
      expect(utcMidnight(params.currentStart)).toMatch(/T00:00:00\.000Z$/);
      expect(utcMidnight(params.todayStart)).toMatch(/T00:00:00\.000Z$/);
      expect(new Date(Number(params.currentStart) * 1000).getUTCDay()).toBe(1);
    }
  );

  it('does not let the previous week touch the current one', () => {
    const params = withTz('Australia/Sydney', () => buildInsightsParams());
    expect(params.prevEnd).toBe(params.currentStart - 1n);
    expect(Number(params.currentStart) - Number(params.prevStart)).toBe(7 * 86400);
  });
});
