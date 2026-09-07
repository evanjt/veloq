/**
 * The map tab's sport and distance cuts.
 *
 * Both were inline in the screen's memo, where the unit system was read but
 * not listed as a dependency, so flipping metric to imperial left the filter
 * cutting on the old thresholds until something else changed. A pure function
 * makes the unit system an argument rather than something captured.
 */

export type MapDistanceFilter = 'all' | 'xshort' | 'short' | 'medium' | 'long';

export interface MapFilterActivity {
  type: string;
  distance: number;
}

/** Band edges in metres. Imperial uses the mile equivalents, 3, 6 and 30. */
export function mapDistanceThresholds(isMetric: boolean): {
  xshort: number;
  short: number;
  medium: number;
} {
  return isMetric
    ? { xshort: 5000, short: 10000, medium: 50000 }
    : { xshort: 4828, short: 9656, medium: 48280 };
}

/**
 * The activities the map should draw. A sport selection narrows nothing until
 * the athlete has deselected at least one type, so the category chips keep
 * their full counts.
 */
export function filterMapActivities<T extends MapFilterActivity>(
  activities: T[],
  selectedTypes: ReadonlySet<string>,
  availableTypeCount: number,
  distanceFilter: MapDistanceFilter,
  isMetric: boolean
): T[] {
  let result = activities;

  if (selectedTypes.size > 0 && selectedTypes.size < availableTypeCount) {
    result = result.filter((a) => selectedTypes.has(a.type));
  }

  if (distanceFilter === 'all') return result;

  const thresholds = mapDistanceThresholds(isMetric);
  return result.filter((a) => {
    if (distanceFilter === 'xshort') return a.distance < thresholds.xshort;
    if (distanceFilter === 'short') {
      return a.distance >= thresholds.xshort && a.distance < thresholds.short;
    }
    if (distanceFilter === 'medium') {
      return a.distance >= thresholds.short && a.distance < thresholds.medium;
    }
    return a.distance >= thresholds.medium;
  });
}
