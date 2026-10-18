/**
 * Expected behaviour: both activity card variants and the detail hero print a
 * distance and a climb only when the activity carries one. A flat ride with an
 * altitude stream climbed 0 m; a trainer ride with no altitude stream has no
 * climb at all, and a swim with no distance has no distance.
 */

import { cardPrimaryStats, type PrimaryStatsInput } from '../cardPrimaryStats';

function activity(overrides: Partial<PrimaryStatsInput>): PrimaryStatsInput {
  return {
    distance: 30000,
    movingTime: 3600,
    elevationGain: 250,
    hasAltitude: true,
    ...overrides,
  };
}

it('prints distance, time and climb for an outdoor ride', () => {
  expect(cardPrimaryStats(activity({}), true)).toEqual({
    distance: '30.0 km',
    duration: '1:00:00',
    elevation: '250 m',
  });
});

it('prints a measured zero climb when the activity has an altitude stream', () => {
  expect(cardPrimaryStats(activity({ elevationGain: 0 }), true).elevation).toBe('0 m');
});

it('prints no climb for an activity with no altitude stream', () => {
  const trainer = activity({ elevationGain: 0, hasAltitude: false });
  expect(cardPrimaryStats(trainer, true).elevation).toBeNull();
});

it('prints a climb the feed carries even without an altitude stream', () => {
  const unknown = activity({ elevationGain: 120, hasAltitude: false });
  expect(cardPrimaryStats(unknown, false).elevation).toBe('394 ft');
});

it('prints no distance for an activity that covered none', () => {
  expect(cardPrimaryStats(activity({ distance: 0 }), true).distance).toBeNull();
  expect(cardPrimaryStats(activity({ distance: NaN }), true).distance).toBeNull();
});

it('prints no distance, no climb and an absent time for a body that carries none', () => {
  expect(cardPrimaryStats({ hasAltitude: true }, true)).toEqual({
    distance: null,
    duration: '--',
    elevation: null,
  });
});
