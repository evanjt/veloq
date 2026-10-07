/**
 * Hook for getting route match info for a specific activity.
 * Used in activity detail views.
 */

import { useMemo } from 'react';
import type { RouteGroup as NativeRouteGroup } from 'veloqrs';
import type { RouteGroup } from '@/types';
import { toActivityType } from '@/types';

interface UseRouteMatchResult {
  /** The route group this activity belongs to */
  routeGroup: RouteGroup | null;
  /** ID of the representative activity for this route */
  representativeActivityId: string | null;
}

const NO_MATCH: UseRouteMatchResult = { routeGroup: null, representativeActivityId: null };

/** Matches an activity against groups the caller already read; it reads none itself. */
export function useRouteMatch(
  activityId: string | undefined,
  groups: readonly NativeRouteGroup[]
): UseRouteMatchResult {
  return useMemo(() => {
    if (!activityId) return NO_MATCH;

    const routeGroup = groups.find((g) => g.activityIds.includes(activityId));
    if (!routeGroup) return NO_MATCH;

    // The engine hands every group the name it is shown under, the athlete's
    // own or its number in the current language.
    const typedGroup: RouteGroup = {
      id: routeGroup.groupId,
      name: routeGroup.customName ?? '',
      type: toActivityType(undefined),
      activityIds: routeGroup.activityIds,
      activityCount: routeGroup.activityIds.length,
      firstDate: '', // Not available from engine
      lastDate: '', // Not available from engine
    };

    return {
      routeGroup: typedGroup,
      representativeActivityId: routeGroup.representativeId || null,
    };
  }, [activityId, groups]);
}
