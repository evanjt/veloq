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
 * The bounding box centre is the fallback for an activity the engine holds no
 * signature for, which is one that has no GPS track yet.
 */

import type { ActivityBoundsItem } from '@/types';

import { getBoundsCenter } from '@/shared/geo/polyline';

/** `[longitude, latitude]`, the order GeoJSON and MapLibre take. */
export type LngLat = [number, number];

/**
 * An activity's start, which the engine gives `[lat, lng]`, as `[lng, lat]`.
 * Null when there is none or either coordinate is not finite. The one reader
 * of that tuple, for the marker and the drawn start dot alike.
 */
export function startLngLat(start: ActivityBoundsItem['startPoint']): LngLat | null {
  if (!start) return null;
  const [lat, lng] = start;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

export function startCenterFor(activity: ActivityBoundsItem): LngLat {
  return startLngLat(activity.startPoint) ?? getBoundsCenter(activity.bounds);
}
