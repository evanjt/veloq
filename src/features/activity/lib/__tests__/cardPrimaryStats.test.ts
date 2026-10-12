/**
 * Expected behaviour: both activity card variants and the detail hero print a
 * distance and a climb only when the activity carries one. A flat ride with an
 * altitude stream climbed 0 m; a trainer ride with no altitude stream has no
 * climb at all, and a swim with no distance has no distance.
 */

import type { Activity } from '@/types';
import { cardPrimaryStats } from '../cardPrimaryStats';

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: 'a1',
    name: 'Orchard loop',
    type: 'Ride',
    start_date_local: '2026-03-14T08:00:00',
    moving_time: 3600,
    elapsed_time: 3700,
    distance: 30000,
    total_elevation_gain: 250,
    average_speed: 8.3,
    max_speed: 14,
    stream_types: ['time', 'distance', 'latlng', 'altitude'],
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
  expect(cardPrimaryStats(activity({ total_elevation_gain: 0 }), true).elevation).toBe('0 m');
});

it('prints no climb for an activity with no altitude stream', () => {
  const trainer = activity({ total_elevation_gain: 0, stream_types: ['time', 'watts'] });
  expect(cardPrimaryStats(trainer, true).elevation).toBeNull();
});

it('prints no climb when the stream list is unknown and the gain is zero', () => {
  const unknown = activity({ total_elevation_gain: 0, stream_types: undefined });
  expect(cardPrimaryStats(unknown, true).elevation).toBeNull();
});

it('prints a climb the feed carries even without a stream list', () => {
  const unknown = activity({ total_elevation_gain: 120, stream_types: undefined });
  expect(cardPrimaryStats(unknown, false).elevation).toBe('394 ft');
});

it('prints no distance for an activity that covered none', () => {
  expect(cardPrimaryStats(activity({ distance: 0 }), true).distance).toBeNull();
  expect(cardPrimaryStats(activity({ distance: NaN }), true).distance).toBeNull();
});
