/**
 * Scenario: 200 virtual rides in one simulated world and 120 outdoor rides at
 * home. Expected behaviour: the opening camera frames home, and a library of
 * only virtual rides still opens on its own cluster.
 */

import { densestClusterIndices } from '@/features/maps/lib/densestCluster';
import { openingClusterActivities } from '@/features/maps/lib/openingClusterActivities';
import type { ActivityBoundsItem } from '@/types';

function ride(id: string, lat: number, lng: number, isVirtual: boolean): ActivityBoundsItem {
  return {
    id,
    bounds: [
      [lat, lng],
      [lat + 0.01, lng + 0.01],
    ],
    type: isVirtual ? 'VirtualRide' : 'Ride',
    name: id,
    date: '2026-01-15T10:00:00Z',
    distance: 40_000,
    duration: 3600,
    isVirtual,
  };
}

function openedOn(activities: ActivityBoundsItem[]): string[] {
  const framed = openingClusterActivities(activities);
  const centres = framed.map((a) => ({ lat: a.bounds[0][0], lng: a.bounds[0][1] }));
  return densestClusterIndices(centres).map((i) => framed[i].id);
}

describe('openingClusterActivities', () => {
  it('opens on home when virtual rides outnumber outdoor ones', () => {
    const virtual = Array.from({ length: 200 }, (_, i) => ride(`v${i}`, -11.65, 166.94, true));
    const home = Array.from({ length: 120 }, (_, i) => ride(`h${i}`, 47.56, 7.59, false));
    const ids = openedOn([...virtual, ...home]);
    expect(ids).toHaveLength(120);
    expect(ids.every((id) => id.startsWith('h'))).toBe(true);
  });

  it('opens on the virtual cluster when every activity is virtual', () => {
    const virtual = Array.from({ length: 5 }, (_, i) => ride(`v${i}`, -11.65, 166.94, true));
    expect(openedOn(virtual)).toHaveLength(5);
  });

  it('treats an activity with no flag as outdoor and an empty library as empty', () => {
    const { isVirtual: _flag, ...plain } = ride('a', 47.5, 7.5, false);
    expect(openingClusterActivities([plain, ride('v', 0, 0, true)])).toEqual([plain]);
    expect(openingClusterActivities([])).toEqual([]);
  });
});
