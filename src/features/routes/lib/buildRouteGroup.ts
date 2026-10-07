import type { RouteGroup as EngineRouteGroup } from 'veloqrs';
import { toActivityType } from '../types';
import type { LatLngShort } from '@/shared/geo/distance';

export function buildRouteGroupBase(engineGroup: EngineRouteGroup | null | undefined) {
  if (!engineGroup) return null;
  return {
    id: engineGroup.groupId,
    name: engineGroup.customName ?? '',
    type: toActivityType(undefined),
    activityIds: engineGroup.activityIds,
    activityCount: engineGroup.activityIds.length,
    firstDate: '', // Not available from engine
    lastDate: '', // Will be computed from activities
    signature: null as { points: LatLngShort[]; distance: number } | null,
  };
}

export function buildFinalRouteGroup(
  routeGroupBase: ReturnType<typeof buildRouteGroupBase>,
  representativePoints: LatLngShort[] | null | undefined,
  routeStatsDistance: number
) {
  if (!routeGroupBase) return null;
  return {
    ...routeGroupBase,
    signature: representativePoints
      ? {
          points: representativePoints,
          distance: routeStatsDistance,
        }
      : null,
  };
}
