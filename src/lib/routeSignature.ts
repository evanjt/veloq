/**
 * Route signature generation utilities.
 * Includes Douglas-Peucker simplification and region hashing.
 */

import type { RoutePoint, RouteSignature, RouteMatchConfig } from '@/types';
import { DEFAULT_ROUTE_MATCH_CONFIG } from '@/types';
import { debug } from './debug';

const log = debug.create('RouteSignature');

/**
 * Calculate the perpendicular distance from a point to a line.
 */
function perpendicularDistance(
  point: RoutePoint,
  lineStart: RoutePoint,
  lineEnd: RoutePoint
): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;

  // Handle case where line is actually a point
  const lineLengthSquared = dx * dx + dy * dy;
  if (lineLengthSquared === 0) {
    return haversineDistance(point, lineStart);
  }

  // Calculate perpendicular distance using cross product method
  const t = Math.max(0, Math.min(1,
    ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / lineLengthSquared
  ));

  const closestPoint: RoutePoint = {
    lat: lineStart.lat + t * dy,
    lng: lineStart.lng + t * dx,
  };

  return haversineDistance(point, closestPoint);
}

/**
 * Calculate haversine distance between two points in meters.
 */
export function haversineDistance(p1: RoutePoint, p2: RoutePoint): number {
  const R = 6371000; // Earth radius in meters
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Douglas-Peucker line simplification algorithm.
 * Reduces the number of points while preserving route shape.
 */
export function douglasPeucker(
  points: RoutePoint[],
  toleranceMeters: number
): RoutePoint[] {
  if (points.length < 3) return points;

  // Find the point with the maximum distance from the line between first and last
  let maxDistance = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance exceeds tolerance, recursively simplify
  if (maxDistance > toleranceMeters) {
    const leftPart = douglasPeucker(points.slice(0, maxIndex + 1), toleranceMeters);
    const rightPart = douglasPeucker(points.slice(maxIndex), toleranceMeters);

    // Combine results, avoiding duplicate middle point
    return [...leftPart.slice(0, -1), ...rightPart];
  }

  // All points within tolerance, return just endpoints
  return [first, last];
}

/**
 * Simplify a route to approximately the target number of points.
 * Uses adaptive tolerance to achieve target.
 */
export function simplifyRoute(
  points: RoutePoint[],
  targetPoints: number = DEFAULT_ROUTE_MATCH_CONFIG.targetPoints,
  initialTolerance: number = DEFAULT_ROUTE_MATCH_CONFIG.simplificationTolerance
): RoutePoint[] {
  if (points.length <= targetPoints) return points;

  let tolerance = initialTolerance;
  let simplified = douglasPeucker(points, tolerance);

  // Adjust tolerance to get closer to target (max 5 iterations)
  for (let i = 0; i < 5 && Math.abs(simplified.length - targetPoints) > targetPoints * 0.2; i++) {
    if (simplified.length > targetPoints) {
      tolerance *= 1.5;
    } else {
      tolerance *= 0.7;
    }
    simplified = douglasPeucker(points, tolerance);
  }

  return simplified;
}

/**
 * Calculate total route distance in meters.
 * Filters out outlier gaps (> 10km between consecutive points) that likely indicate GPS errors.
 */
export function calculateRouteDistance(points: RoutePoint[]): number {
  if (!points || points.length < 2) {
    return 0;
  }

  let total = 0;
  const MAX_STEP_DISTANCE = 10000; // 10km - any step longer than this is likely GPS error

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];

    // Skip if points are invalid
    if (!p1 || !p2 || !isFinite(p1.lat) || !isFinite(p1.lng) || !isFinite(p2.lat) || !isFinite(p2.lng)) {
      continue;
    }

    const stepDistance = haversineDistance(p1, p2);

    // Skip outlier gaps (GPS errors, etc.) or invalid distances
    if (!isFinite(stepDistance) || stepDistance > MAX_STEP_DISTANCE) {
      continue;
    }

    total += stepDistance;
  }
  return total;
}

/**
 * Calculate bounding box for a set of points.
 */
export function calculateBounds(points: RoutePoint[]): RouteSignature['bounds'] {
  if (points.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLng = points[0].lng;
  let maxLng = points[0].lng;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Generate a region hash for a point (geohash-like grid).
 * Used for quick start/end region matching.
 */
export function generateRegionHash(
  point: RoutePoint,
  gridSize: number = DEFAULT_ROUTE_MATCH_CONFIG.regionGridSize
): string {
  // Round to grid cell
  const latCell = Math.floor(point.lat / gridSize);
  const lngCell = Math.floor(point.lng / gridSize);
  return `${latCell},${lngCell}`;
}

/**
 * Check if a route is a loop (start and end are close together).
 */
export function isLoop(
  points: RoutePoint[],
  threshold: number = DEFAULT_ROUTE_MATCH_CONFIG.loopThreshold
): boolean {
  if (points.length < 2) return false;
  const startEndDistance = haversineDistance(points[0], points[points.length - 1]);
  return startEndDistance < threshold;
}

/**
 * Generate a route signature from GPS coordinates.
 */
export function generateRouteSignature(
  activityId: string,
  latlngs: [number, number][],
  config: Partial<RouteMatchConfig> = {}
): RouteSignature {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };

  // Convert to RoutePoint format, filtering out invalid points
  const originalCount = latlngs.length;
  const points: RoutePoint[] = latlngs
    .filter(([lat, lng]) => {
      // Validate that values are reasonable lat/lng
      const validLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
      const validLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
      return validLat && validLng;
    })
    .map(([lat, lng]) => ({ lat, lng }));

  // Log if any points were filtered out
  if (points.length < originalCount) {
    log.warn(`Filtered out ${originalCount - points.length} invalid points (${points.length}/${originalCount} valid)`);
    // Log first invalid point for debugging
    const firstInvalid = latlngs.find(([lat, lng]) => {
      const validLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
      const validLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
      return !(validLat && validLng);
    });
    if (firstInvalid) {
      log.warn(`  First invalid point: [${firstInvalid[0]}, ${firstInvalid[1]}]`);
    }
  }

  if (points.length === 0) {
    return {
      activityId,
      points: [],
      distance: 0,
      bounds: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 },
      center: { lat: 0, lng: 0 },
      startRegionHash: '',
      endRegionHash: '',
      isLoop: false,
    };
  }

  // Simplify the route
  let simplifiedPoints = simplifyRoute(points, cfg.targetPoints, cfg.simplificationTolerance);

  // Safety: ensure we have at least 3 points for a meaningful shape
  // If simplification reduced too aggressively, use uniform sampling instead
  if (simplifiedPoints.length < 3 && points.length >= 3) {
    log.warn(`Simplification too aggressive (${simplifiedPoints.length} points), using uniform sampling`);
    const step = Math.max(1, Math.floor(points.length / Math.min(cfg.targetPoints, points.length)));
    simplifiedPoints = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    log.log(`Uniform sampling: ${simplifiedPoints.length} points`);
  }

  // Calculate metrics
  const distance = calculateRouteDistance(points); // Use original points for accurate distance
  const bounds = calculateBounds(simplifiedPoints);

  // Log suspicious distances (> 500km for a single activity is unusual)
  if (distance > 500000) {
    log.warn(`Activity ${activityId}: Unusually large distance ${(distance/1000).toFixed(1)}km from ${points.length} points`);
  }

  // Generate region hashes for start and end
  const startRegionHash = generateRegionHash(simplifiedPoints[0], cfg.regionGridSize);
  const endRegionHash = generateRegionHash(
    simplifiedPoints[simplifiedPoints.length - 1],
    cfg.regionGridSize
  );

  // Check if loop
  const routeIsLoop = isLoop(simplifiedPoints, cfg.loopThreshold);

  // Calculate center point from bounds
  const center = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };

  return {
    activityId,
    points: simplifiedPoints,
    distance,
    bounds,
    center,
    startRegionHash,
    endRegionHash,
    isLoop: routeIsLoop,
  };
}

/**
 * Calculate bounds overlap percentage between two bounding boxes.
 * Returns 0 if no overlap, 1 if one is completely inside the other.
 */
export function calculateBoundsOverlap(
  bounds1: RouteSignature['bounds'],
  bounds2: RouteSignature['bounds']
): number {
  // Calculate intersection
  const intersectMinLat = Math.max(bounds1.minLat, bounds2.minLat);
  const intersectMaxLat = Math.min(bounds1.maxLat, bounds2.maxLat);
  const intersectMinLng = Math.max(bounds1.minLng, bounds2.minLng);
  const intersectMaxLng = Math.min(bounds1.maxLng, bounds2.maxLng);

  // No overlap
  if (intersectMinLat >= intersectMaxLat || intersectMinLng >= intersectMaxLng) {
    return 0;
  }

  // Calculate areas
  const intersectArea =
    (intersectMaxLat - intersectMinLat) * (intersectMaxLng - intersectMinLng);

  const area1 =
    (bounds1.maxLat - bounds1.minLat) * (bounds1.maxLng - bounds1.minLng);
  const area2 =
    (bounds2.maxLat - bounds2.minLat) * (bounds2.maxLng - bounds2.minLng);

  // Return overlap as fraction of smaller area
  const smallerArea = Math.min(area1, area2);
  if (smallerArea === 0) return 0;

  return intersectArea / smallerArea;
}

/**
 * Quick filter to check if two routes might match.
 * Uses bounds overlap, distance comparison, and endpoint proximity.
 *
 * Updated to use actual haversine distance for endpoint comparison instead of
 * region hashes, which were too coarse (500m grid) for routes 5-10m apart.
 */
export function quickFilterMatch(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: Partial<RouteMatchConfig> = {}
): boolean {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };

  // Check bounds overlap
  const overlap = calculateBoundsOverlap(sig1.bounds, sig2.bounds);
  if (overlap < cfg.minBoundsOverlap) {
    return false;
  }

  // Check distance difference
  const distanceDiff = Math.abs(sig1.distance - sig2.distance);
  const maxDistance = Math.max(sig1.distance, sig2.distance);
  if (maxDistance > 0 && distanceDiff / maxDistance > cfg.maxDistanceDifference) {
    return false;
  }

  // For loops, we're more lenient - just check bounds/distance
  if (sig1.isLoop && sig2.isLoop) {
    return true;
  }

  // Get actual endpoint coordinates for precise comparison
  const start1 = sig1.points[0];
  const end1 = sig1.points[sig1.points.length - 1];
  const start2 = sig2.points[0];
  const end2 = sig2.points[sig2.points.length - 1];

  if (!start1 || !end1 || !start2 || !end2) {
    return false;
  }

  // Check if at least one endpoint pair is within 500m
  // This is more precise than region hashes which could miss routes at grid boundaries
  const ENDPOINT_THRESHOLD = 500; // meters

  const startToStart = haversineDistance(start1, start2);
  const startToEnd = haversineDistance(start1, end2);
  const endToStart = haversineDistance(end1, start2);
  const endToEnd = haversineDistance(end1, end2);

  // For same direction: start-to-start AND end-to-end should be close
  const sameDirection = startToStart < ENDPOINT_THRESHOLD && endToEnd < ENDPOINT_THRESHOLD;

  // For reverse direction: start-to-end AND end-to-start should be close
  const reverseDirection = startToEnd < ENDPOINT_THRESHOLD && endToStart < ENDPOINT_THRESHOLD;

  // At least one direction should match
  return sameDirection || reverseDirection;
}

/**
 * Reverse a route signature (for comparing reverse directions).
 */
export function reverseSignature(sig: RouteSignature): RouteSignature {
  const reversedPoints = [...sig.points].reverse();
  return {
    ...sig,
    points: reversedPoints,
    startRegionHash: sig.endRegionHash,
    endRegionHash: sig.startRegionHash,
  };
}
