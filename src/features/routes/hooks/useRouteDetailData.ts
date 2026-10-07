import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { RouteDetailData } from 'veloqrs';
import {
  classifyDetailRead,
  type DetailRead,
  type DetailReadStatus,
} from '../lib/detailReadResult';

/** Route groups on the detail screen need at least this many attempts. */
export const MIN_GROUP_ACTIVITIES = 1;

/**
 * Single engine call for the route detail screen.
 *
 * Covers the route, the group list it is ranked within, every attempt across
 * sports, the representative polyline, names, exclusions and signatures. The
 * performances come back unfiltered, so the sport pills are derived without a
 * second read and only a sport change costs another call.
 */
export function useRouteDetailData(
  groupId: string | undefined,
  currentActivityId: string | undefined,
  refreshKey = 0
): DetailRead<RouteDetailData> {
  const readGroups = useEngineRead(['groups'], [refreshKey]);

  return useMemo(() => {
    const closed: DetailRead<RouteDetailData> = { status: { kind: 'closed' }, data: null };
    if (!groupId) return { status: { kind: 'missing' } as DetailReadStatus, data: null };
    return (
      readGroups((engine) =>
        classifyDetailRead(
          () => engine.getRouteDetailData(groupId, currentActivityId, MIN_GROUP_ACTIVITIES),
          (result) => result,
          (result) => !result.group
        )
      ) ?? closed
    );
  }, [groupId, currentActivityId, readGroups]);
}
