/**
 * The shape check for a camera read back from storage.
 *
 * A stored camera arrives through `JSON.parse` from settings that a restored
 * backup writes verbatim, so its declared type proves nothing. Every value is
 * interpolated into map page script, and a malformed one breaks the map on
 * every launch, so a camera that fails here reads as no saved camera.
 */

import type { TerrainCamera } from '@/features/maps/lib/cameraAngle';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A `[lng, lat]` pair inside the valid coordinate range. */
export function isLngLat(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

/** A centre and zoom, the regional map's saved position. */
export function isCentreZoom(value: unknown): value is { center: [number, number]; zoom: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { center, zoom } = value as Record<string, unknown>;
  return isLngLat(center) && isFiniteNumber(zoom);
}

/** A full 3D camera: centre, zoom, bearing and pitch. */
export function isTerrainCamera(value: unknown): value is TerrainCamera {
  if (!isCentreZoom(value)) return false;
  const { bearing, pitch } = value as unknown as Record<string, unknown>;
  return isFiniteNumber(bearing) && isFiniteNumber(pitch);
}
