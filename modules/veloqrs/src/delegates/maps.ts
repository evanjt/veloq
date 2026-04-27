/**
 * Map visualization delegates.
 *
 * Spatial queries and bounding-box/viewport helpers backed by the Rust R-tree
 * index. Date inputs are converted to Unix seconds before crossing the FFI.
 */

import type { FfiBounds, MapActivityComplete } from '../generated/veloqrs';
import type { DelegateHost } from './host';

export function getMapActivitiesFiltered(
  host: DelegateHost,
  startDate: Date,
  endDate: Date,
  sportTypesArray?: string[]
): MapActivityComplete[] {
  if (!host.ready) return [];
  const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
  const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
  return host.timed('getMapActivitiesFiltered', () =>
    host.engine.maps().getFiltered(startTs, endTs, sportTypesArray ?? [])
  );
}

export function getActivityBoundsForRange(
  host: DelegateHost,
  startDate: Date,
  endDate: Date,
  sportTypesArray?: string[]
): FfiBounds | null {
  if (!host.ready) return null;
  const startTs = BigInt(Math.floor(startDate.getTime() / 1000));
  const endTs = BigInt(Math.floor(endDate.getTime() / 1000));
  const result = host.timed('getActivityBoundsForRange', () =>
    host.engine.maps().getBoundsForRange(startTs, endTs, sportTypesArray ?? [])
  );
  return result ?? null;
}

export function getAllMapSignatures(
  host: DelegateHost
): Array<{ activityId: string; encodedCoords: ArrayBuffer; centerLat: number; centerLng: number }> {
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
  return host.timed('queryViewport', () =>
    host.engine.maps().queryViewport(minLat, maxLat, minLng, maxLng)
  );
}
