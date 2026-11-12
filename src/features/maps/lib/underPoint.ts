/**
 * The key of a heatmap tap's traces at a `veloq-geo` URL, and the zoom a tap is
 * answered at.
 *
 * The engine reads the tap, the zoom and the group out of the key, so the key
 * and the engine call that listed the group are built from the same three
 * values.
 */
import { TRACE_ZOOM_THRESHOLD } from './mapBudgets';

/** The zoom from which a tap on the heatmap lists the activities under it. */
export const UNDER_POINT_MIN_ZOOM = TRACE_ZOOM_THRESHOLD;

/** The deepest zoom the engine accepts a tap at. */
const UNDER_POINT_MAX_ZOOM = 24;

/** The group the activities in no route are asked for under. */
const NO_ROUTE_GROUP = '_';

/** The whole zoom the camera has passed, which is what the engine reads. */
export function underPointZoom(zoom: number): number {
  return Math.min(UNDER_POINT_MAX_ZOOM, Math.max(0, Math.floor(zoom)));
}

/**
 * `<lat_e6>_<lng_e6>_<zoom>_<group>`: the tap in micro-degrees, the whole zoom
 * it was made at, and a route id or `_` for the activities in no route.
 */
export function underPointKey(
  latitude: number,
  longitude: number,
  zoom: number,
  routeId: string | null
): string {
  const micro = (degrees: number) => String(Math.round(degrees * 1e6) || 0);
  return `${micro(latitude)}_${micro(longitude)}_${zoom}_${routeId ?? NO_ROUTE_GROUP}`;
}
