/**
 * Geometry utilities for GPS coordinate processing.
 */

/**
 * Haversine distance between two points in meters.
 */
export function haversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const dLon = ((point2.lng - point1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((point1.lat * Math.PI) / 180) *
      Math.cos((point2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Compute overlap between two polylines.
 * Returns 0-1 representing the fraction of polylineA points that are close to polylineB.
 *
 * @param polylineA - First polyline
 * @param polylineB - Second polyline
 * @param thresholdMeters - Distance threshold for considering points as matching (default 50m)
 * @returns Overlap ratio (0-1)
 */
export function computePolylineOverlap(
  polylineA: Array<{ lat: number; lng: number }>,
  polylineB: Array<{ lat: number; lng: number }>,
  thresholdMeters = 50
): number {
  if (polylineA.length === 0 || polylineB.length === 0) return 0;

  let matchedCount = 0;

  for (const pointA of polylineA) {
    for (const pointB of polylineB) {
      const distance = haversineDistance(pointA, pointB);
      if (distance <= thresholdMeters) {
        matchedCount++;
        break;
      }
    }
  }

  return matchedCount / polylineA.length;
}

/**
 * Calculate perpendicular distance from a point to a line segment.
 * Uses equirectangular approximation for conversion to meters.
 */
function perpendicularDistance(
  point: { lat: number; lng: number },
  lineStart: { lat: number; lng: number },
  lineEnd: { lat: number; lng: number }
): number {
  // Convert to meters using simple equirectangular approximation
  const R = 6371000; // Earth radius in meters
  const lat = (point.lat * Math.PI) / 180;

  const x = (((point.lng - lineStart.lng) * Math.PI) / 180) * Math.cos(lat) * R;
  const y = (((point.lat - lineStart.lat) * Math.PI) / 180) * R;

  const x2 = (((lineEnd.lng - lineStart.lng) * Math.PI) / 180) * Math.cos(lat) * R;
  const y2 = (((lineEnd.lat - lineStart.lat) * Math.PI) / 180) * R;

  const dx = x2;
  const dy = y2;
  const len = Math.sqrt(dx * dx + dy * dy);

  // If line has zero length, return distance to point
  if (len === 0) return Math.sqrt(x * x + y * y);

  // Perpendicular distance formula: |cross product| / |line length|
  return Math.abs(dy * x - dx * y) / len;
}

/**
 * Douglas-Peucker polyline simplification algorithm.
 * Reduces point count while preserving shape within tolerance.
 *
 * @param points - Array of points with lat/lng properties
 * @param tolerance - Distance tolerance in meters (default 5m)
 * @returns Simplified array of points
 *
 * @example
 * // Simplify a GPS track to reduce storage size
 * const simplified = simplifyPolyline(track, 5); // 5m tolerance
 * console.log(`Reduced ${track.length} → ${simplified.length} points`);
 */
export function simplifyPolyline<T extends { lat: number; lng: number }>(
  points: T[],
  tolerance: number = 5
): T[] {
  // Need at least 2 points to simplify
  if (points.length <= 2) return points;

  // Find point with maximum perpendicular distance from line
  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance exceeds tolerance, recursively simplify both halves
  if (maxDist > tolerance) {
    const left = simplifyPolyline(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPolyline(points.slice(maxIndex), tolerance);
    // Combine, avoiding duplicate at split point
    return [...left.slice(0, -1), ...right];
  }

  // All intermediate points within tolerance - just keep endpoints
  return [first, last];
}
