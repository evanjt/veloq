/**
 * Hook for getting map activities directly from the Rust engine.
 * All filtering happens in Rust (single O(n) pass) - no JS filtering.
 */
import { useMemo, useState, useEffect } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
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
  const [activityCount, setActivityCount] = useState(0);

  // Subscribe to engine activity changes
  useEffect(() => {
    if (!enabled) return;

    const engine = getRouteEngine();
    if (!engine) return;

    // Initial count
    setActivityCount(engine.getActivityCount());

    // Subscribe to updates
    const unsubscribe = engine.subscribe('activities', () => {
      const eng = getRouteEngine();
      setActivityCount(eng ? eng.getActivityCount() : 0);
    });

    return unsubscribe;
  }, [enabled]);

  // Get filtered activities from engine (all filtering in Rust)
  const { activities, availableTypes } = useMemo(() => {
    if (!enabled || activityCount === 0) {
      return { activities: [], availableTypes: [] };
    }

    const engine = getRouteEngine();
    if (!engine) {
      return { activities: [], availableTypes: [] };
    }

    // Get all activities to extract available types
    const allActivities = engine.getAllMapActivitiesComplete();
    if (allActivities.length === 0) {
      return { activities: [], availableTypes: [] };
    }

    // Extract available sport types
    const types = new Set<string>();
    allActivities.forEach((a) => types.add(a.sportType));
    const availableTypesList = Array.from(types).sort();

    // Get filtered activities from engine (filtering in Rust)
    const sportTypesArray = selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined;
    const filtered = engine.getMapActivitiesFiltered(startDate, endDate, sportTypesArray);

    // Convert to ActivityBoundsItem format
    const items: ActivityBoundsItem[] = filtered.map((a) => ({
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
      availableTypes: availableTypesList,
    };
  }, [enabled, activityCount, startDate, endDate, selectedTypes]);

  return {
    activities,
    totalCount: activityCount,
    isReady: activityCount > 0,
    availableTypes,
  };
}
