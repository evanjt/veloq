/**
 * Scenario: the map's distance filter cuts on metres, and its cut points are
 * different numbers in metric and imperial.
 * Expected behaviour: the same library filtered under the two unit systems
 * gives different sets, so the unit system is part of the filter and not
 * something read once.
 */

import { filterMapActivities, mapDistanceThresholds } from '@/features/maps/lib/mapDistanceFilter';

function activity(id: string, type: string, distance: number) {
  return { id, type, distance };
}

/** A ride at 4,900 m: over 3 miles, under 5 km. */
const BETWEEN = activity('between', 'Ride', 4900);

const LIBRARY = [
  activity('tiny', 'Ride', 1000),
  BETWEEN,
  activity('mid', 'Run', 20000),
  activity('epic', 'Ride', 90000),
];

describe('the map distance filter', () => {
  it('cuts a ride between three miles and five kilometres differently by unit system', () => {
    const metric = filterMapActivities(LIBRARY, new Set(), 4, 'xshort', true);
    const imperial = filterMapActivities(LIBRARY, new Set(), 4, 'xshort', false);

    expect(metric.map((a) => a.id)).toContain('between');
    expect(imperial.map((a) => a.id)).not.toContain('between');
  });

  it('uses mile equivalents in imperial and round kilometres in metric', () => {
    expect(mapDistanceThresholds(true)).toEqual({ xshort: 5000, short: 10000, medium: 50000 });
    expect(mapDistanceThresholds(false)).toEqual({ xshort: 4828, short: 9656, medium: 48280 });
  });

  it('leaves the library alone when the filter is off', () => {
    expect(filterMapActivities(LIBRARY, new Set(), 4, 'all', true)).toHaveLength(4);
  });

  it('bands short, medium and long against the same thresholds', () => {
    const ids = (band: 'short' | 'medium' | 'long') =>
      filterMapActivities(LIBRARY, new Set(), 4, band, true).map((a) => a.id);

    expect(ids('short')).toEqual([]);
    expect(ids('medium')).toEqual(['mid']);
    expect(ids('long')).toEqual(['epic']);
  });

  it('narrows by sport only once the athlete has deselected something', () => {
    const all = filterMapActivities(LIBRARY, new Set(['Ride', 'Run']), 2, 'all', true);
    const rides = filterMapActivities(LIBRARY, new Set(['Ride']), 2, 'all', true);

    expect(all).toHaveLength(4);
    expect(rides.map((a) => a.id)).toEqual(['tiny', 'between', 'epic']);
  });

  it('applies both cuts together', () => {
    const result = filterMapActivities(LIBRARY, new Set(['Ride']), 2, 'long', true);

    expect(result.map((a) => a.id)).toEqual(['epic']);
  });
});
