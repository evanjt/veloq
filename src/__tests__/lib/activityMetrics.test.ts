/**
 * Tests for the power zone entries filter.
 */

import { powerZoneEntries } from '@/shared/activity/activityMetrics';

describe('power zone entries beside the zone ids', () => {
  const rideWithSweetSpot = [
    { id: 'Z1', secs: 188 },
    { id: 'Z2', secs: 275 },
    { id: 'Z3', secs: 124 },
    { id: 'Z4', secs: 86 },
    { id: 'Z5', secs: 59 },
    { id: 'Z6', secs: 69 },
    { id: 'Z7', secs: 97 },
    { id: 'SS', secs: 80 },
  ];

  it('leaves the overlapping Sweet Spot entry out', () => {
    expect(powerZoneEntries(rideWithSweetSpot).map((z) => z.secs)).toEqual([
      188, 275, 124, 86, 59, 69, 97,
    ]);
  });
});
