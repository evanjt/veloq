import { useState } from 'react';
import type { SectionTimeRange } from '@/features/routes/constants';
import { DEFAULT_PERIOD } from '@/shared/app/period';

export function useSectionUIState() {
  // Defer map loading until after first paint for faster perceived load
  const [mapReady, setMapReady] = useState(false);
  // Time range for chart data (passed to useSectionChartData)
  const [sectionTimeRange, setSectionTimeRange] = useState<SectionTimeRange>(DEFAULT_PERIOD);

  // Sport type filter for cross-sport sections
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

  return {
    mapReady,
    setMapReady,
    sectionTimeRange,
    setSectionTimeRange,
    selectedSportType,
    setSelectedSportType,
  };
}
