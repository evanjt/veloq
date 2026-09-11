import { decodeCoords } from 'veloqrs';
import type { GroupWithPolyline } from 'veloqrs';

import { computeCenter } from '@/shared/geo/distance';
import type { RouteGroup } from '@/types';
import { toActivityType } from '@/features/routes/types';

/**
 * Convert batch GroupWithPolyline to RouteGroup with pre-loaded consensus points.
 * Avoids per-row useConsensusRoute FFI calls.
 */
export function batchGroupToRouteGroup(group: GroupWithPolyline): RouteGroup {
  const sportType = group.sportType || 'Ride';
  // Decode delta+varint encoded polyline to RoutePoint[]
  // encodedPolyline after Rust rebuild; consensusPolyline on stale bindings
  const polylineData =
    (group as Record<string, unknown>).encodedPolyline ??
    (group as Record<string, unknown>).consensusPolyline;
  const consensusPoints = (
    polylineData instanceof ArrayBuffer ? decodeCoords(polylineData) : []
  ).map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  const center = group.bounds
    ? computeCenter({
        minLat: group.bounds.minLat,
        maxLat: group.bounds.maxLat,
        minLng: group.bounds.minLng,
        maxLng: group.bounds.maxLng,
      })
    : undefined;
  return {
    id: group.groupId,
    // Unnamed stays unnamed. The number is the engine's to mint, and it
    // does not mint it in this list's order, so one invented here changes
    // under the athlete. `RouteRow` renders its own localised default.
    name: group.customName ?? '',
    type: toActivityType(sportType),
    activityCount: group.activityCount,
    activityIds: [],
    signature: null,
    consensusPoints,
    distance: group.distanceMeters > 0 ? group.distanceMeters : undefined,
    sportTypes: group.sportTypes ?? [sportType],
    center,
  };
}
