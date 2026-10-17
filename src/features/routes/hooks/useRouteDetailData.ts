import { useMemo } from 'react';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import type { RouteDetailData } from 'veloqrs';
import {
  classifyDetailRead,
  type DetailRead,
  type DetailReadStatus,
} from '../lib/detailReadResult';

/**
 * The route detail screen's read of what one sport and one range do not
 * change: the route and its shown name, the representative polyline and
 * headline, exclusions and signatures. Attempt times come from
 * `useRouteDetailPerformance`.
 */
export function useRouteDetailData(
  groupId: string | undefined,
  refreshKey = 0
): DetailRead<RouteDetailData> {
  const readGroups = useEngineRead(['groups'], [refreshKey]);

  return useMemo(() => {
    const closed: DetailRead<RouteDetailData> = { status: { kind: 'closed' }, data: null };
    if (!groupId) return { status: { kind: 'missing' } as DetailReadStatus, data: null };
    return (
      readGroups((engine) =>
        classifyDetailRead(
          () => engine.getRouteDetailData(groupId),
          (result) => result,
          (result) => !result.group
        )
      ) ?? closed
    );
  }, [groupId, readGroups]);
}
