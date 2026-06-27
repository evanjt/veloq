import { useEffect, useMemo, useState } from 'react';
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

  // Auto-select the group's primary sport type when sport types are available
  useEffect(() => {
    if (availableSportTypes.length > 1 && selectedSportType === undefined && engineGroup) {
      setSelectedSportType(engineGroup.sportType || availableSportTypes[0]);
    }
  }, [availableSportTypes, selectedSportType, engineGroup]);

  // Get performance data filtered by selected sport type (no API call needed)
  // Activity metrics are cached in Rust engine's in-memory HashMap
  const sportFilter = availableSportTypes.length > 1 ? selectedSportType : undefined;

  return {
    selectedSportType,
    setSelectedSportType,
    availableSportTypes,
    sportFilter,
  };
}
