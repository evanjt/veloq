import { decodeCoords } from 'veloqrs';
import type { GroupWithPolyline } from 'veloqrs';

import { computeCenter } from '@/shared/geo/distance';
import type { RouteGroup } from '@/types';
import { toActivityType } from '@/features/routes/types';

/**
 * Convert batch GroupWithPolyline to RouteGroup with pre-loaded representative points.
 * Avoids per-row useRepresentativeRoute FFI calls.
 */
export function batchGroupToRouteGroup(group: GroupWithPolyline): RouteGroup {
  // Decode delta+varint encoded polyline to RoutePoint[]
  const representativePoints = decodeCoords(group.encodedPolyline).map((p) => ({
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
    type: toActivityType(undefined),
    activityCount: group.activityCount,
    activityIds: [],
    signature: null,
    representativePoints,
    distance: group.distanceMeters > 0 ? group.distanceMeters : undefined,
    sportTypes: group.sportTypes,
    center,
  };
}
