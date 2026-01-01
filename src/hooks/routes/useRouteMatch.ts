/**
 * Hook for getting route match info for a specific activity.
 * Used in activity detail views.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useRouteEngine';
import type { RouteGroup } from '@/types';
import { toActivityType } from '@/types';

interface UseRouteMatchResult {
  /** The route group this activity belongs to */
  routeGroup: RouteGroup | null;
  /** Activity's rank within the route group (by position in list) */
  rank: number | null;
  /** Total activities in the route group */
  totalInGroup: number;
  /** Whether the activity has been processed */
  isProcessed: boolean;
}

export function useRouteMatch(activityId: string | undefined): UseRouteMatchResult {
  const { groups } = useEngineGroups({ minActivities: 1 });

  return useMemo(() => {
    if (!activityId) {
      return {
        routeGroup: null,
        rank: null,
        totalInGroup: 0,
        isProcessed: false,
      };
    }

    // Find the group containing this activity
    const routeGroup = groups.find((g) => g.activityIds.includes(activityId));

    if (!routeGroup) {
      return {
        routeGroup: null,
        rank: null,
        totalInGroup: 0,
        isProcessed: true, // It was processed but not in a group
      };
    }

    // Calculate rank (position in group's activity list)
    const idx = routeGroup.activityIds.indexOf(activityId);
    const rank = idx >= 0 ? idx + 1 : null;

    // Convert to RouteGroup type
    const typedGroup: RouteGroup = {
      id: routeGroup.groupId,
      name: routeGroup.groupId, // Use groupId as name for now
      type: toActivityType(routeGroup.sportType),
      activityIds: routeGroup.activityIds,
      activityCount: routeGroup.activityIds.length,
      firstDate: '', // Not available from engine
      lastDate: '', // Not available from engine
    };

    return {
      routeGroup: typedGroup,
      rank,
      totalInGroup: routeGroup.activityIds.length,
      isProcessed: true,
    };
  }, [activityId, groups]);
}
