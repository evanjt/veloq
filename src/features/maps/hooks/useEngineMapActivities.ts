/**
 * Hook for getting map activities directly from the Rust engine.
 * All filtering happens in Rust (single O(n) pass) - no JS filtering.
 */
import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { ActivityBoundsItem } from '@/types';

interface UseEngineMapActivitiesOptions {
  /** Start of date range filter */
  startDate: Date;
  /** End of date range filter */
  endDate: Date;
  /** Sport types to include (empty = all types) */
  selectedTypes: Set<string>;
  /** Whether to enable the hook (allows conditional usage) */
  enabled?: boolean;
}

interface UseEngineMapActivitiesReturn {
  /** Filtered activities ready for map rendering */
  activities: ActivityBoundsItem[];
  /** Total activities in engine (unfiltered count) */
  totalCount: number;
  /** Whether engine data is available */
  isReady: boolean;
  /** Available sport types from engine data */
  availableTypes: string[];
}

/**
 * Get map activities directly from the Rust engine with filtering.
 * Filtering is performed entirely in Rust for maximum performance.
 */
export function useEngineMapActivities({
  startDate,
  endDate,
  selectedTypes,
  enabled = true,
}: UseEngineMapActivitiesOptions): UseEngineMapActivitiesReturn {
  // The reader carries the subscription: its identity changes when the channel
  // fires and at no other time, so the memo below reads it and re-runs then.
  const readEngine = useEngineRead(['activities']);

  // One call: engine total, sport types and the filtered activities.
  const { activities, availableTypes, activityCount } = useMemo(() => {
    const empty = { activities: [], availableTypes: [], activityCount: 0 };
    if (!enabled) return empty;

    const sportTypesArray = selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined;
    const data = readEngine((engine) =>
      engine.getMapScreenData(startDate, endDate, sportTypesArray)
    );
    if (!data || data.activityCount === 0) return empty;

    // Convert to ActivityBoundsItem format
    const items: ActivityBoundsItem[] = data.activities.map((a) => ({
      id: a.activityId,
      bounds: [
        [a.bounds.minLat, a.bounds.minLng],
        [a.bounds.maxLat, a.bounds.maxLng],
      ],
      type: a.sportType as ActivityBoundsItem['type'],
      name: a.name,
      // Convert Unix timestamp (seconds, bigint) to ISO string
      date: new Date(Number(a.date) * 1000).toISOString(),
      distance: a.distance,
      duration: a.duration,
      startPoint:
        a.startLat !== null &&
        a.startLat !== undefined &&
        a.startLng !== null &&
        a.startLng !== undefined
          ? ([a.startLat, a.startLng] as [number, number])
          : undefined,
    }));

    return {
      activities: items,
      availableTypes: data.availableSportTypes,
      activityCount: data.activityCount,
    };
  }, [enabled, readEngine, startDate, endDate, selectedTypes]);

  return {
    activities,
    totalCount: activityCount,
    isReady: activityCount > 0,
    availableTypes,
  };
}
