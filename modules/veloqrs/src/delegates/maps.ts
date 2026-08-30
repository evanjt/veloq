/**
 * Map visualization delegates.
 *
 * Spatial queries and bounding-box/viewport helpers backed by the Rust R-tree
 * index. Date inputs are converted to Unix seconds before crossing the FFI.
 */

import type { FfiBounds, FfiMapScreenData, MapActivityComplete } from '../generated/veloqrs';
import type { DelegateHost } from './host';

/**
 * Everything the map tab paints with in one round-trip: the engine total, the
 * sport types the filter chips offer, and the activities inside the window.
 */
export function getMapScreenData(
  host: DelegateHost,
  startDate: Date,
  endDate: Date,
  sportTypesArray?: string[]
): FfiMapScreenData | undefined {
  if (!host.ready) return undefined;
  const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
  const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
  return host.timed('getMapScreenData', () =>
    host.engine.maps().getScreenData(startTs, endTs, sportTypesArray ?? [])
  );
}

export function getAllMapSignatures(
  host: DelegateHost
): { activityId: string; encodedCoords: ArrayBuffer; centerLat: number; centerLng: number }[] {
  if (!host.ready) return [];
  return host.timed('getAllMapSignatures', () => host.engine.maps().getAllSignatures());
}

export function getMapSignaturesForIds(
  host: DelegateHost,
  ids: string[]
): { activityId: string; encodedCoords: ArrayBuffer; centerLat: number; centerLng: number }[] {
  if (!host.ready || ids.length === 0) return [];
  return host.timed('getMapSignaturesForIds', () => host.engine.maps().getSignaturesForIds(ids));
}

export function queryViewport(
  host: DelegateHost,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number
): string[] {
  if (!host.ready) return [];
  return host.timed('queryViewport', () =>
    host.engine.maps().queryViewport(minLat, maxLat, minLng, maxLng)
  );
}
