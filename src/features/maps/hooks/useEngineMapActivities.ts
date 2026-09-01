/**
 * Hook for getting map activities directly from the Rust engine.
 * All filtering happens in Rust (single O(n) pass) - no JS filtering.
 */
import { useMemo, useState, useEffect } from 'react';
import { getEngine } from '@/shared/native/engine';
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
  // Bumped by the engine subscription; the count itself comes from the bundle.
  const [trigger, setTrigger] = useState(0);

  // Subscribe to engine activity changes - retry if engine not ready on mount
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    function trySubscribe(): boolean {
      const engine = getEngine();
      if (!engine) return false;

      if (!cancelled) {
        setTrigger((v) => v + 1);
      }

      unsubscribe = engine.subscribe('activities', () => {
        if (cancelled) return;
        setTrigger((v) => v + 1);
      });
      return true;
    }

    if (!trySubscribe()) {
      const interval = setInterval(() => {
        if (trySubscribe()) {
          clearInterval(interval);
        }
      }, 200);
      return () => {
        cancelled = true;
        clearInterval(interval);
        unsubscribe?.();
      };
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled]);

  // One call: engine total, sport types and the filtered activities.
  const { activities, availableTypes, activityCount } = useMemo(() => {
    const empty = { activities: [], availableTypes: [], activityCount: 0 };
    if (!enabled) return empty;

    const engine = getEngine();
    if (!engine) return empty;

    const sportTypesArray = selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined;
    const data = engine.getMapScreenData(startDate, endDate, sportTypesArray);
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
    }));

    return {
      activities: items,
      availableTypes: data.availableSportTypes,
      activityCount: data.activityCount,
    };
  }, [enabled, trigger, startDate, endDate, selectedTypes]);

  return {
    activities,
    totalCount: activityCount,
    isReady: activityCount > 0,
    availableTypes,
  };
}
