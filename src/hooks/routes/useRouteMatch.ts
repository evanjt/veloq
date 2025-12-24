/**
 * Hook for getting route match info for a specific activity.
 * Used in activity detail views.
 */

import { useMemo } from 'react';
import { useRouteMatchStore } from '@/providers/RouteMatchStore';
import type { RouteMatch, RouteGroup } from '@/types';

interface UseRouteMatchResult {
  /** The match info for this activity */
  match: RouteMatch | null;
  /** The route group this activity belongs to */
  routeGroup: RouteGroup | null;
  /** Activity's rank within the route group (by date, 1 = earliest) */
  rank: number | null;
  /** Total activities in the route group */
  totalInGroup: number;
  /** Whether the activity has been processed */
  isProcessed: boolean;
}

export function useRouteMatch(activityId: string | undefined): UseRouteMatchResult {
  const cache = useRouteMatchStore((s) => s.cache);

  return useMemo(() => {
    if (!activityId || !cache) {
      return {
        match: null,
        routeGroup: null,
        rank: null,
        totalInGroup: 0,
        isProcessed: false,
      };
    }

    const isProcessed = cache.processedActivityIds.includes(activityId);

    // Use reverse index for O(1) lookup
    const routeGroupId = cache.activityToRouteId?.[activityId];

    if (!routeGroupId) {
      // Activity not in any route group
      return {
        match: null,
        routeGroup: null,
        rank: null,
        totalInGroup: 0,
        isProcessed,
      };
    }

    const routeGroup = cache.groups.find((g) => g.id === routeGroupId) || null;
    const match = cache.matches[activityId] || null;

    // Calculate rank (position in group's activity list)
    let rank: number | null = null;
    if (routeGroup) {
      const idx = routeGroup.activityIds.indexOf(activityId);
      if (idx >= 0) {
        rank = idx + 1;
      }
    }

    return {
      match,
      routeGroup,
      rank,
      totalInGroup: routeGroup?.activityCount || 0,
      isProcessed,
    };
  }, [activityId, cache]);
}
