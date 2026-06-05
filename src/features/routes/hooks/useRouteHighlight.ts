import { useCallback, useState } from 'react';
import type { RoutePoint } from '../types';

export function useRouteHighlight() {
  // State for highlighted activity (chart scrubbing → map)
  const [highlightedActivityId, setHighlightedActivityId] = useState<string | null>(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);

  // Handle activity selection from chart scrubbing
  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    []
  );

  return {
    highlightedActivityId,
    setHighlightedActivityId,
    highlightedActivityPoints,
    setHighlightedActivityPoints,
    handleActivitySelect,
  };
}
