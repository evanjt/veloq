/**
 * Hook for getting route match info for a specific activity.
 * Used in activity detail views.
 */

import { useMemo } from 'react';
import { useEngineGroups } from './useEngine';
import type { RouteGroup as NativeRouteGroup } from 'veloqrs';
import type { RouteGroup } from '@/types';
import { toActivityType } from '@/types';

/** Engine groups supplied by a caller that already fetched them. */
type RouteGroupsInput = readonly NativeRouteGroup[];

interface UseRouteMatchResult {
  /** The route group this activity belongs to */
  routeGroup: RouteGroup | null;
  /** Activity's rank within the route group (by position in list) */
  rank: number | null;
  /** Total activities in the route group */
  totalInGroup: number;
  /** Whether the activity has been processed */
  isProcessed: boolean;
  /** ID of the representative activity for this route */
  representativeActivityId: string | null;
}

export function useRouteMatch(
  activityId: string | undefined,
  enabled = true,
  preComputedGroups?: RouteGroupsInput
): UseRouteMatchResult {
  const skipOwnFfiCall = preComputedGroups !== undefined;
  const { groups: queriedGroups } = useEngineGroups({
    minActivities: 1,
    enabled: enabled && !skipOwnFfiCall,
  });
  const groups = preComputedGroups ?? queriedGroups;

  return useMemo(() => {
    if (!activityId) {
      return {
        routeGroup: null,
        rank: null,
        totalInGroup: 0,
        isProcessed: false,
        representativeActivityId: null,
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
        representativeActivityId: null,
      };
    }

    // Calculate rank (position in group's activity list)
    const idx = routeGroup.activityIds.indexOf(activityId);
    const rank = idx >= 0 ? idx + 1 : null;

    // Generate a readable name if no custom name is set
    // Find the index of this group among same sport type groups for numbering
    const sameTypeGroups = groups.filter((g) => g.sportType === routeGroup.sportType);
    const groupIndex = sameTypeGroups.findIndex((g) => g.groupId === routeGroup.groupId) + 1;
    const sportType = routeGroup.sportType || 'Route';
    const defaultName = `${sportType} Route ${groupIndex}`;

    // Convert to RouteGroup type
    const typedGroup: RouteGroup = {
      id: routeGroup.groupId,
      name: routeGroup.customName || defaultName,
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
      representativeActivityId: routeGroup.representativeId || null,
    };
  }, [activityId, groups]);
}
