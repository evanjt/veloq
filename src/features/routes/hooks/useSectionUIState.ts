import { useState } from 'react';
import type { MergeCandidate } from 'veloqrs';
import type { RoutePoint } from '@/types';
import type { SectionTimeRange } from '@/features/routes/constants';

export function useSectionUIState() {
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);
  // Track if user is actively scrubbing - used to defer expensive map updates
  const [isScrubbing, setIsScrubbing] = useState(false);
  // Defer map loading until after first paint for faster perceived load
  const [mapReady, setMapReady] = useState(false);
  // Merge dialog state
  const [mergeTarget, setMergeTarget] = useState<MergeCandidate | null>(null);
  // Shown when 2+ candidates — lets user pick which to merge.
  const [showMergePicker, setShowMergePicker] = useState(false);

  // Time range for chart data (passed to useSectionChartData)
  const [sectionTimeRange, setSectionTimeRange] = useState<SectionTimeRange>('all');

  // Sport type filter for cross-sport sections
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);

  return {
    highlightedActivityId,
    setHighlightedActivityId,
    highlightedActivityPoints,
    setHighlightedActivityPoints,
    isScrubbing,
    setIsScrubbing,
    mapReady,
    setMapReady,
    mergeTarget,
    setMergeTarget,
    showMergePicker,
    setShowMergePicker,
    sectionTimeRange,
    setSectionTimeRange,
    selectedSportType,
    setSelectedSportType,
  };
}
