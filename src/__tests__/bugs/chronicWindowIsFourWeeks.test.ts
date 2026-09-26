/**
 * Scenario: the chronic average is the four weeks before last week, and the
 * engine reads the window as `chronic_start .. prev_start` while dividing by a
 * fixed four. The parameters set `chronic_start` 28 days before the *current*
 * week, so the window is 21 days and an athlete at a steady 200 TSS a week is
 * told last week was a third above their four-week average.
 *
 * Expected behaviour: the window the engine reads is 28 days long, so the
 * divisor and the window agree.
 */

import { buildInsightsParams } from '@/features/insights/lib/insightsParams';

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => false,
}));

const WEEK = 7 * 86_400;

describe('the chronic window', () => {
  it('is the four weeks the average divides by', () => {
    const { chronicStart, prevStart } = buildInsightsParams();

    expect(prevStart - chronicStart).toBe(4 * WEEK);
  });

  it('ends where last week starts, so neither this week nor last week is in it', () => {
    const { chronicStart, prevStart, currentStart } = buildInsightsParams();

    expect(prevStart).toBe(currentStart - WEEK);
    expect(chronicStart).toBe(currentStart - 5 * WEEK);
  });
});
