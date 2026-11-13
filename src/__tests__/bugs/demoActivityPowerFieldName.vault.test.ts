/**
 * Scenario: demo mode seeds the same body table a live sync writes, so a demo
 * activity carrying a field the Activity schema lacks gives a reader a value
 * no live sync ever supplies. Normalised power is `icu_weighted_avg_watts` on
 * an activity and `weighted_average_watts` only on an interval.
 *
 * Expected behaviour: demo rides carry the Activity schema's name, and their
 * intervals still take normalised power from it.
 */

import { getActivities, getActivityIntervals } from '@/shared/demo/activity';

describe('demo activity normalised power', () => {
  const rides = () => getActivities().filter((activity) => activity.type === 'Ride');

  it('uses the Activity schema field and never the interval one', () => {
    expect(rides().length).toBeGreaterThan(0);
    for (const ride of rides()) {
      expect(ride).not.toHaveProperty('weighted_average_watts');
      expect(ride).toHaveProperty('icu_weighted_avg_watts');
    }
  });

  it('derives interval normalised power from the activity field', () => {
    const ride = rides().find((activity) => (activity.icu_weighted_avg_watts ?? 0) > 0);
    expect(ride).toBeDefined();
    const { icu_intervals } = getActivityIntervals(ride!.id);
    expect(icu_intervals.some((interval) => (interval.weighted_average_watts ?? 0) > 0)).toBe(true);
  });
});
