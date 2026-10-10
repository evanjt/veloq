/**
 * Map visualization delegates.
 *
 * Spatial queries and bounding-box/viewport helpers backed by the Rust R-tree
 * index. Date inputs are converted to Unix seconds before crossing the FFI.
 */

import type { FfiMapScreenData, MapDistanceBand } from '../generated/veloqrs';
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

export function queryViewport(
  host: DelegateHost,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): string[] {
  if (!host.ready) return [];
  return host.timed(
    'queryViewport',
    () => host.engine.maps().queryViewport(minLat, maxLat, minLng, maxLng),
    'gesture'
  );
}
