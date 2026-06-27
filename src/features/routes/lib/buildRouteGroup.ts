import type { RouteGroup as EngineRouteGroup } from 'veloqrs';
import { toActivityType } from '../types';

export function buildRouteGroupBase(engineGroup: EngineRouteGroup | null | undefined) {
  if (!engineGroup) return null;
  return {
    id: engineGroup.groupId,
    name: engineGroup.customName ?? engineGroup.groupId,
    type: toActivityType(engineGroup.sportType || 'Ride'),
    activityIds: engineGroup.activityIds,
    activityCount: engineGroup.activityIds.length,
    firstDate: '', // Not available from engine
    lastDate: '', // Will be computed from activities
    signature: null as { points: any[]; distance: number } | null,
  };
}

export function buildFinalRouteGroup(
  routeGroupBase: ReturnType<typeof buildRouteGroupBase>,
  consensusPoints: Array<{ lat: number; lng: number }> | null | undefined,
  routeStatsDistance: number
) {
  if (!routeGroupBase) return null;
  return {
    ...routeGroupBase,
    signature: consensusPoints
      ? {
          points: consensusPoints,
          distance: routeStatsDistance,
        }
      : null,
  };
}
