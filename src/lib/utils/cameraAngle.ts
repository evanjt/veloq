/**
 * Auto-calculate the best camera angle for a route's 3D terrain preview.
 *
 * When altitude data is available, positions the camera on the LOW side
 * of the route looking TOWARD high terrain for dramatic, clipping-free views.
 * Falls back to perpendicular-to-route bearing when altitude is unavailable or flat.
 */

export interface TerrainCamera {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing: number; // 0-360
  pitch: number; // degrees
}

/** Minimum elevation range (meters) to use elevation-aware camera */
const FLAT_THRESHOLD = 30;

/** Elevation ranges for adaptive pitch */
const MEDIUM_ELEVATION = 100;
const MOUNTAINOUS_ELEVATION = 400;

/** Zoom reduction threshold for tall terrain with exaggeration */
const ZOOM_REDUCTION_THRESHOLD = 300;

/**
 * Calculate optimal terrain camera parameters for a route.
 *
 * Algorithm:
 * 1. Compute bounding box and center
 * 2. If altitude data with sufficient range is available:
 *    - Compute elevation gradient vector (weighted sum of point offsets from center)
 *    - Camera bearing points toward high terrain (MapLibre positions camera opposite)
 *    - Shift center 8% toward camera (low side) to avoid clipping
 *    - Adaptive pitch: flatter for mountainous terrain (avoids exaggerated peaks)
 *    - Reduce zoom for very tall terrain
 * 3. Fallback: perpendicular to start→end bearing, 60° pitch
 *
 * @param coordinates - Route coordinates as [lng, lat] pairs
 * @param altitude - Optional altitude array (meters) matching coordinate indices
 * @returns Camera parameters for 3D terrain view
 */
export function calculateTerrainCamera(
  coordinates: [number, number][],
  altitude?: number[]
): TerrainCamera {
  if (coordinates.length === 0) {
    return { center: [0, 0], zoom: 10, bearing: 0, pitch: 60 };
  }

  if (coordinates.length === 1) {
    return { center: coordinates[0], zoom: 13, bearing: 0, pitch: 60 };
  }

  // Calculate bounding box
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coordinates) {
    if (!isFinite(lng) || !isFinite(lat)) continue;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  if (!isFinite(minLng) || !isFinite(minLat)) {
    return { center: [0, 0], zoom: 10, bearing: 0, pitch: 60 };
  }

  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;

  // Calculate zoom from bounds span
  // paddingFactor 2.0 gives ~30% margin around the route in terrain previews
  let zoom: number;
  if (latSpan < 0.0001 && lngSpan < 0.0001) {
    zoom = 14;
  } else {
    const paddingFactor = 2.0;
    const latZoom = Math.log2(180 / (latSpan * paddingFactor || 0.001));
    const lngZoom = Math.log2(360 / (lngSpan * paddingFactor || 0.001));
    zoom = Math.min(latZoom, lngZoom);
  }
  zoom = Math.max(8, Math.min(15, isFinite(zoom) ? zoom : 10));

  // Try elevation-aware camera
  const elevationResult = computeElevationCamera(coordinates, altitude, centerLng, centerLat);

  if (elevationResult) {
    // Shift center 8% of bbox span toward camera (away from high terrain)
    const bearingRad = (elevationResult.bearing * Math.PI) / 180;
    // Camera sits opposite to bearing, so shift center opposite to bearing (toward camera)
    const offsetLng = -Math.sin(bearingRad) * lngSpan * 0.08;
    const offsetLat = -Math.cos(bearingRad) * latSpan * 0.08;

    // Reduce zoom for very tall terrain (exaggerated peaks need room)
    if (elevationResult.elevationRange > ZOOM_REDUCTION_THRESHOLD) {
      zoom = Math.max(8, zoom - 0.5);
    }

    return {
      center: [centerLng + offsetLng, centerLat + offsetLat],
      zoom,
      bearing: elevationResult.bearing,
      pitch: elevationResult.pitch,
    };
  }

  // Fallback: perpendicular to route direction
  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const dLng = end[0] - start[0];
  const dLat = end[1] - start[1];
  const routeBearing = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  const bearing = (routeBearing + 90 + 360) % 360;

  return {
    center: [centerLng, centerLat],
    zoom,
    bearing,
    pitch: 60,
  };
}

/**
 * Compute elevation-aware bearing and pitch from altitude data.
 *
 * Uses an elevation gradient vector: for each GPS point, compute a vector
 * from center to that point weighted by (altitude - mean). The sum points
 * toward high terrain. Camera bearing faces that direction so MapLibre
 * positions the camera on the low side.
 *
 * @returns bearing, pitch, and elevation range, or null if altitude data is insufficient
 */
function computeElevationCamera(
  coordinates: [number, number][],
  altitude: number[] | undefined,
  centerLng: number,
  centerLat: number
): { bearing: number; pitch: number; elevationRange: number } | null {
  if (!altitude || altitude.length === 0) return null;

  // Use only points where both coordinate and altitude are valid
  const len = Math.min(coordinates.length, altitude.length);
  if (len < 2) return null;

  // Find min/max altitude
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let altSum = 0;
  let validCount = 0;

  for (let i = 0; i < len; i++) {
    const alt = altitude[i];
    if (!isFinite(alt)) continue;
    if (alt < minAlt) minAlt = alt;
    if (alt > maxAlt) maxAlt = alt;
    altSum += alt;
    validCount++;
  }

  if (validCount < 2 || !isFinite(minAlt) || !isFinite(maxAlt)) return null;

  const elevationRange = maxAlt - minAlt;
  if (elevationRange < FLAT_THRESHOLD) return null;

  const meanAlt = altSum / validCount;

  // Compute elevation gradient vector
  let gradLng = 0;
  let gradLat = 0;

  for (let i = 0; i < len; i++) {
    const alt = altitude[i];
    const [lng, lat] = coordinates[i];
    if (!isFinite(alt) || !isFinite(lng) || !isFinite(lat)) continue;

    const weight = alt - meanAlt;
    gradLng += (lng - centerLng) * weight;
    gradLat += (lat - centerLat) * weight;
  }

  // Check if gradient is meaningful (non-zero)
  const gradMagnitude = Math.sqrt(gradLng * gradLng + gradLat * gradLat);
  if (gradMagnitude < 1e-12) return null;

  // Bearing toward high terrain (atan2 with lng as x, lat as y for compass bearing)
  const bearing = (Math.atan2(gradLng, gradLat) * 180) / Math.PI;
  const normalizedBearing = (bearing + 360) % 360;

  // Adaptive pitch based on elevation range
  // With 1.5x terrain exaggeration, lower pitch for mountainous terrain
  let pitch: number;
  if (elevationRange < MEDIUM_ELEVATION) {
    pitch = 62; // Flat-ish: more top-down, shows route layout
  } else if (elevationRange < MOUNTAINOUS_ELEVATION) {
    pitch = 58; // Medium: balanced
  } else {
    pitch = 52; // Mountainous: more horizontal, dramatic views
  }

  return { bearing: normalizedBearing, pitch, elevationRange };
}
