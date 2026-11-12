/**
 * Map visualization delegates.
 *
 * Spatial queries and bounding-box/viewport helpers backed by the Rust R-tree
 * index. Date inputs are converted to Unix seconds before crossing the FFI.
 */

import type {
  FfiActivitiesUnderPoint,
  FfiMapScreenData,
  MapDistanceBand,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * Everything the map tab paints with in one round-trip: the engine total, the
 * sport types the filter chips offer, and the activities inside the window.
 *
 * `heldRouteLines` and `heldSections` are the stamps of the layers the caller
 * already holds. A layer still current under its stamp comes back without its
 * lines.
 */
export function getMapScreenData(
  host: DelegateHost,
  startDate: Date,
  endDate: Date,
  sportTypesArray: string[],
  distanceBand: MapDistanceBand,
  isMetric: boolean,
  routeLines: boolean,
  sections: boolean,
  nameNeedle: string,
  heldRouteLines?: number,
  heldSections?: number
): FfiMapScreenData | undefined {
  if (!host.ready) return undefined;
  const startTs = startDate.getTime() / 1000;
  const endTs = endDate.getTime() / 1000;
  return host.timed('getMapScreenData', () =>
    host.engine
      .maps()
      .getScreenData(
        startTs,
        endTs,
        sportTypesArray,
        distanceBand,
        isMetric,
        routeLines,
        sections,
        nameNeedle,
        heldRouteLines,
        heldSections
      )
  );
}

export function getAllMapSignatures(host: DelegateHost): {
  activityId: string;
  encodedCoords: ArrayBuffer;
  centerLat: number;
  centerLng: number;
}[] {
  if (!host.ready) return [];
  return host.timed('getAllMapSignatures', () => host.engine.maps().getAllSignatures());
}

/**
 * The activities whose tracks pass under a point on the heatmap, grouped by
 * route and capped, newest first. Resolves with no groups when the heatmap is
 * off or the engine is not ready.
 */
export async function getActivitiesUnderPoint(
  host: DelegateHost,
  latitude: number,
  longitude: number,
  zoom: number
): Promise<FfiActivitiesUnderPoint> {
  if (!host.ready) return { total: 0, truncated: false, traceCap: 0, groups: [] };
  return host.timedAsync('getActivitiesUnderPoint', () =>
    host.engine.maps().activitiesUnderPoint(latitude, longitude, zoom)
  );
}
