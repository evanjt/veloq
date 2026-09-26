import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { RouteDetailData } from 'veloqrs';

/** Route groups on the detail screen need at least this many attempts. */
export const MIN_GROUP_ACTIVITIES = 1;

/**
 * Single engine call for the route detail screen.
 *
 * Covers the route, the group list it is ranked within, every attempt across
 * sports, the consensus polyline, names, exclusions and signatures. The
 * performances come back unfiltered, so the sport pills are derived without a
 * second read and only a sport change costs another call.
 */
export function useRouteDetailData(
  groupId: string | undefined,
  currentActivityId: string | undefined
): RouteDetailData | null {
  const readGroups = useEngineRead(['groups']);

  return useMemo(() => {
    if (!groupId) return null;
    try {
      return (
        readGroups((engine) =>
          engine.getRouteDetailData(groupId, currentActivityId, MIN_GROUP_ACTIVITIES)
        ) ?? null
      );
    } catch {
      return null;
    }
  }, [groupId, currentActivityId, readGroups]);
}
