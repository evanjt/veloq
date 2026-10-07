import { useMemo, useState } from 'react';
import type { FfiActivityMetrics } from 'veloqrs';

/**
 * The sport picker on a route that has been covered by more than one sport.
 *
 * It starts on the sport most of the route's activities carry.
 */
export function useSportTypeFilter(allMetrics: Map<string, FfiActivityMetrics>) {
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

  // One pass over the members, since the list and the default are both the
  // same count read two ways.
  const counts = useMemo(() => {
    const tally = new Map<string, number>();
    for (const m of allMetrics.values()) {
      if (m.sportType) tally.set(m.sportType, (tally.get(m.sportType) ?? 0) + 1);
    }
    return tally;
  }, [allMetrics]);

  const availableSportTypes = useMemo(() => Array.from(counts.keys()).sort(), [counts]);

  // Most-covered first, a tie settled alphabetically so the picker opens the
  // same way on every render and on every device.
  const dominantSportType = useMemo(
    () =>
      availableSportTypes.reduce<string | undefined>(
        (best, sport) =>
          best === undefined || (counts.get(sport) ?? 0) > (counts.get(best) ?? 0) ? sport : best,
        undefined
      ),
    [availableSportTypes, counts]
  );

  // Derived rather than written into state by an effect, so the picker is never
  // drawn with nothing selected.
  const defaultSportType = availableSportTypes.length > 1 ? dominantSportType : undefined;
  const effectiveSportType = selectedSportType ?? defaultSportType;

  // Get performance data filtered by selected sport type (no API call needed)
  // Activity metrics are cached in Rust engine's in-memory HashMap
  const sportFilter = availableSportTypes.length > 1 ? effectiveSportType : undefined;

  return {
    selectedSportType: effectiveSportType,
    setSelectedSportType,
    availableSportTypes,
    sportFilter,
  };
}
