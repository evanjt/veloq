import { useMemo, useState } from 'react';
import type { RouteGroup as EngineRouteGroup, FfiActivityMetrics } from 'veloqrs';

export function useSportTypeFilter(
  allMetrics: Map<string, FfiActivityMetrics>,
  engineGroup: EngineRouteGroup | null | undefined
) {
  // Sport type selector state
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

  // Compute available sport types from all activity metrics
  const availableSportTypes = useMemo(() => {
    const types = new Set<string>();
    for (const m of allMetrics.values()) {
      if (m.sportType) types.add(m.sportType);
    }
    const sorted = Array.from(types).sort();
    return sorted;
  }, [allMetrics]);

  // The group's primary sport type stands until the athlete picks another. It
  // is derived rather than written into state by an effect, so the picker is
  // never drawn with nothing selected.
  const defaultSportType =
    availableSportTypes.length > 1 && engineGroup
      ? engineGroup.sportType || availableSportTypes[0]
      : undefined;
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
