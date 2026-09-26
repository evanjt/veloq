/**
 * Where an activity's map marker sits.
 *
 * The engine's signature record holds the start of the ride, and the map screen
 * read now carries it, so the marker goes to the right place on the first
 * upload. Before that the start only arrived with the signatures load, which
 * runs after interactions: every marker went up on its bounding box centre and
 * the whole set was uploaded again, and re-clustered, once the real starts
 * landed.
 *
 * The fallbacks are for an activity the engine holds no signature for, which is
 * one that has no GPS track yet.
 */

import type { ActivityBoundsItem } from '@/types';

import { getBoundsCenter } from '@/shared/geo/polyline';

/** `[longitude, latitude]`, the order GeoJSON and MapLibre take. */
export type LngLat = [number, number];

export function startCenterFor(activity: ActivityBoundsItem): LngLat {
  const start = activity.startPoint;
  if (start && Number.isFinite(start[0]) && Number.isFinite(start[1])) {
    return [start[1], start[0]];
  }
  // A track cached during sync, still in [lat, lng] order.
  const first = activity.latlngs?.[0];
  if (first && Number.isFinite(first[0]) && Number.isFinite(first[1])) {
    return [first[1], first[0]];
  }
  return getBoundsCenter(activity.bounds);
}
