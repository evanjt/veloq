import { useMemo } from 'react';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineSubscription } from '@/features/routes/hooks/useRouteEngine';
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
  const trigger = useEngineSubscription(['groups']);

  return useMemo(() => {
    if (!groupId) return null;
    const engine = getRouteEngine();
    if (!engine) return null;
    try {
      return engine.getRouteDetailData(groupId, currentActivityId, MIN_GROUP_ACTIVITIES) ?? null;
    } catch {
      return null;
    }
  }, [groupId, currentActivityId, trigger]);
}
