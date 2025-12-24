/**
 * Route matching algorithm using Average Minimum Distance (modified Hausdorff).
 *
 * Based on research from trajectory similarity literature:
 * - Simpler and more robust than DTW for GPS data with noise
 * - Uses normalized point sampling for consistent comparison
 * - Checks both directions (asymmetric distance)
 *
 * References:
 * - https://www.tandfonline.com/doi/full/10.1080/15481603.2021.1908927
 * - Strava's approach: start/end + direction + distance
 */

import type {
  RouteSignature,
  RouteMatch,
  RouteMatchConfig,
  MatchDirection,
  RoutePoint,
} from '@/types';
import { DEFAULT_ROUTE_MATCH_CONFIG } from '@/types';
import {
  haversineDistance,
  quickFilterMatch,
  reverseSignature,
  calculateRouteDistance,
} from './routeSignature';

interface MatchResult {
  matchPercentage: number;
  direction: MatchDirection;
  overlapStart: number;
  overlapEnd: number;
  overlapDistance: number;
  confidence: number;
}

/**
 * Calculate Average Minimum Distance (AMD) from route1 to route2.
 * For each point in route1, find the minimum distance to any point in route2.
 * Return the average of these minimum distances.
 *
 * This is a modified Hausdorff distance - more robust than DTW for GPS data.
 * Reference: https://matt-leach.github.io/blog/strava.html
 */
function averageMinDistance(route1: RoutePoint[], route2: RoutePoint[]): number {
  if (route1.length === 0 || route2.length === 0) return Infinity;

  let totalMinDist = 0;

  for (const p1 of route1) {
    let minDist = Infinity;
    for (const p2 of route2) {
      const d = haversineDistance(p1, p2);
      if (d < minDist) minDist = d;
    }
    totalMinDist += minDist;
  }

  return totalMinDist / route1.length;
}

/**
 * Resample a route to have exactly n points, evenly spaced by distance.
 * This normalizes routes for comparison regardless of original sampling rate.
 * Reference: https://www.dantleech.com/blog/2023/08/27/comparing-paths/
 */
function resampleRoute(points: RoutePoint[], targetCount: number): RoutePoint[] {
  if (points.length < 2) return points;
  if (points.length === targetCount) return points;

  // Calculate total distance
  const totalDist = calculateRouteDistance(points);
  if (totalDist === 0) return points.slice(0, Math.min(points.length, targetCount));

  const stepDist = totalDist / (targetCount - 1);
  const resampled: RoutePoint[] = [points[0]];

  let accumulated = 0;
  let nextThreshold = stepDist;
  let prevPoint = points[0];

  for (let i = 1; i < points.length && resampled.length < targetCount; i++) {
    const curr = points[i];
    const segDist = haversineDistance(prevPoint, curr);

    while (accumulated + segDist >= nextThreshold && resampled.length < targetCount - 1) {
      // Interpolate point at the threshold distance
      const ratio = (nextThreshold - accumulated) / segDist;
      const newLat = prevPoint.lat + ratio * (curr.lat - prevPoint.lat);
      const newLng = prevPoint.lng + ratio * (curr.lng - prevPoint.lng);
      resampled.push({ lat: newLat, lng: newLng });
      nextThreshold += stepDist;
    }

    accumulated += segDist;
    prevPoint = curr;
  }

  // Always include the last point
  if (resampled.length < targetCount) {
    resampled.push(points[points.length - 1]);
  }

  return resampled;
}

/**
 * Convert Average Minimum Distance to a match percentage.
 *
 * - AMD < 30m → 100% match (GPS-accurate same route, accounts for 5-10m GPS variance)
 * - AMD > 250m → 0% match (completely different)
 * - Linear interpolation between
 *
 * Thresholds tuned for real-world GPS data:
 * - GPS accuracy: typically 5-10m, can be 15-20m in urban areas
 * - Same route with GPS noise: AMD typically 10-30m
 * - Similar routes: AMD typically 30-100m
 * - Different routes: AMD typically > 150m
 */
function amdToPercentage(amd: number): number {
  const PERFECT_THRESHOLD = 30;  // Within 30m = same route (tolerates GPS variance)
  const ZERO_THRESHOLD = 250;    // Beyond 250m = different route

  if (amd <= PERFECT_THRESHOLD) return 100;
  if (amd >= ZERO_THRESHOLD) return 0;

  // Linear interpolation
  return 100 * (1 - (amd - PERFECT_THRESHOLD) / (ZERO_THRESHOLD - PERFECT_THRESHOLD));
}

/**
 * Find which portions of route1 are "matched" (within threshold of route2).
 * Returns matched ranges for visualization.
 */
function findMatchedRanges(
  route1: RoutePoint[],
  route2: RoutePoint[],
  threshold: number
): { start: number; end: number }[] {
  const matched = route1.map(p1 => {
    for (const p2 of route2) {
      if (haversineDistance(p1, p2) <= threshold) return true;
    }
    return false;
  });

  const ranges: { start: number; end: number }[] = [];
  let rangeStart = -1;

  for (let i = 0; i < matched.length; i++) {
    if (matched[i] && rangeStart === -1) {
      rangeStart = i;
    } else if (!matched[i] && rangeStart !== -1) {
      ranges.push({ start: rangeStart, end: i - 1 });
      rangeStart = -1;
    }
  }
  if (rangeStart !== -1) {
    ranges.push({ start: rangeStart, end: matched.length - 1 });
  }

  return ranges;
}

/**
 * Compare two route signatures using Average Minimum Distance.
 * This is simpler and more robust than DTW for GPS data with noise.
 *
 * Algorithm:
 * 1. Resample both routes to same number of points (50)
 * 2. Calculate AMD in both directions (asymmetric)
 * 3. Use average of both for final score
 * 4. Convert to percentage
 */
function compareRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: RouteMatchConfig
): {
  matchPercentage: number;
  overlapStart: number;
  overlapEnd: number;
  overlapDistance: number;
  confidence: number;
} {
  const { distanceThreshold } = config;

  // Resample both routes to same number of points for fair comparison
  const SAMPLE_COUNT = 50;
  const resampled1 = resampleRoute(sig1.points, SAMPLE_COUNT);
  const resampled2 = resampleRoute(sig2.points, SAMPLE_COUNT);

  // Calculate AMD in both directions (distance is asymmetric)
  const amd1to2 = averageMinDistance(resampled1, resampled2);
  const amd2to1 = averageMinDistance(resampled2, resampled1);

  // Use average of both directions
  const avgAmd = (amd1to2 + amd2to1) / 2;

  // Convert to percentage
  const matchPercentage = amdToPercentage(avgAmd);

  // Find matched ranges for visualization (using original points)
  const matchedRanges = findMatchedRanges(sig1.points, sig2.points, distanceThreshold * 2);

  // Calculate overlap metrics
  let overlapStart = 0;
  let overlapEnd = 100;
  let matchedDistance = 0;

  if (matchedRanges.length > 0) {
    const first = matchedRanges[0];
    const last = matchedRanges[matchedRanges.length - 1];
    overlapStart = (first.start / sig1.points.length) * 100;
    overlapEnd = ((last.end + 1) / sig1.points.length) * 100;

    // Calculate matched distance
    for (const range of matchedRanges) {
      const rangePoints = sig1.points.slice(range.start, range.end + 1);
      matchedDistance += calculateRouteDistance(rangePoints);
    }
  }

  // Confidence based on point density and consistency
  const minPoints = Math.min(resampled1.length, resampled2.length);
  const confidence = Math.min(1, minPoints / 30);

  return {
    matchPercentage,
    overlapStart,
    overlapEnd,
    overlapDistance: matchedDistance,
    confidence,
  };
}

/**
 * Determine direction using endpoint comparison (not AMD, which is symmetric).
 * Compares sig2's start point to sig1's start and end points.
 * Returns 'same' if sig2 starts near sig1's start, 'reverse' if near sig1's end.
 *
 * For out-and-back routes or loops (where start ≈ end), defaults to 'same'
 * since there's no meaningful direction difference.
 */
function determineDirectionByEndpoints(
  sig1: RouteSignature,
  sig2: RouteSignature
): 'same' | 'reverse' {
  const start1 = sig1.points[0];
  const end1 = sig1.points[sig1.points.length - 1];
  const start2 = sig2.points[0];
  const end2 = sig2.points[sig2.points.length - 1];

  if (!start1 || !end1 || !start2 || !end2) {
    return 'same'; // Default to same if no points
  }

  // Check if either route is a loop/out-and-back (start ≈ end)
  const LOOP_THRESHOLD = 200; // meters
  const sig1IsLoop = haversineDistance(start1, end1) < LOOP_THRESHOLD;
  const sig2IsLoop = haversineDistance(start2, end2) < LOOP_THRESHOLD;

  // If both are loops/out-and-backs, direction is meaningless - default to 'same'
  if (sig1IsLoop && sig2IsLoop) {
    return 'same';
  }

  // Calculate all four endpoint distances
  const startToStart = haversineDistance(start2, start1);
  const startToEnd = haversineDistance(start2, end1);
  const endToEnd = haversineDistance(end2, end1);
  const endToStart = haversineDistance(end2, start1);

  // Score for same direction: start2→start1 + end2→end1
  const sameScore = startToStart + endToEnd;
  // Score for reverse direction: start2→end1 + end2→start1
  const reverseScore = startToEnd + endToStart;

  // Require a significant difference (100m) to call it 'reverse'
  // This prevents GPS noise from flipping the direction
  const MIN_DIRECTION_DIFFERENCE = 100; // meters

  if (reverseScore < sameScore - MIN_DIRECTION_DIFFERENCE) {
    return 'reverse';
  }

  // Default to 'same' if similar or same is better
  return 'same';
}

/**
 * Match two route signatures, checking both forward and reverse directions.
 * Returns the best match result using Average Minimum Distance algorithm.
 * Direction is determined by endpoint comparison (not AMD scores).
 */
export function matchRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: Partial<RouteMatchConfig> = {}
): MatchResult | null {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };

  // Quick filter first (bounding boxes, distance check)
  if (!quickFilterMatch(sig1, sig2, cfg)) {
    return null;
  }

  // Compare routes using AMD for match quality
  const matchResult = compareRoutes(sig1, sig2, cfg);

  // Check if meets minimum threshold
  if (matchResult.matchPercentage < cfg.minMatchPercentage) {
    return null;
  }

  // Determine direction using endpoint comparison (not AMD scores)
  // AMD is symmetric so forward/reverse give identical scores - use endpoints instead
  const endpointDirection = determineDirectionByEndpoints(sig1, sig2);

  // Determine direction type based on match quality
  let direction: MatchDirection;
  if (matchResult.matchPercentage >= 70) {
    // Good match = same route, direction from endpoint comparison
    direction = endpointDirection;
  } else {
    direction = 'partial';
  }

  return {
    matchPercentage: Math.round(matchResult.matchPercentage),
    direction,
    overlapStart: matchResult.overlapStart,
    overlapEnd: matchResult.overlapEnd,
    overlapDistance: matchResult.overlapDistance,
    confidence: matchResult.confidence,
  };
}

/**
 * Find all matching routes for a given signature from a list of candidates.
 */
export function findMatches(
  signature: RouteSignature,
  candidates: RouteSignature[],
  config: Partial<RouteMatchConfig> = {}
): Array<{ candidateId: string; match: MatchResult }> {
  const matches: Array<{ candidateId: string; match: MatchResult }> = [];

  for (const candidate of candidates) {
    // Don't match with self
    if (candidate.activityId === signature.activityId) continue;

    const match = matchRoutes(signature, candidate, config);
    if (match) {
      matches.push({
        candidateId: candidate.activityId,
        match,
      });
    }
  }

  // Sort by match percentage (best first)
  matches.sort((a, b) => b.match.matchPercentage - a.match.matchPercentage);

  return matches;
}

/**
 * Check if two routes should be GROUPED into the same route.
 *
 * PHILOSOPHY: A "route" is a complete, repeated JOURNEY - not a shared section.
 * Two activities are the same route only if they represent the same end-to-end trip.
 *
 * Criteria:
 * 1. Minimum route length - both routes must be at least 500m
 * 2. High path coverage (80%+) - most of the path must be shared
 * 3. Similar total distance (within 20%) - same journey = similar length
 * 4. Same endpoints (within ~200m) - same start AND end location
 * 5. Same middle points - the MIDDLE of both routes must also match
 */
export function shouldGroupRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  matchPercentage: number,
  config: RouteMatchConfig
): boolean {
  const { loopThreshold } = config;

  // CHECK 0: Both routes must be meaningful (at least 500m)
  // This prevents tiny GPS traces or short walks from being grouped
  const MIN_ROUTE_DISTANCE = 500; // meters
  if (sig1.distance < MIN_ROUTE_DISTANCE || sig2.distance < MIN_ROUTE_DISTANCE) {
    return false;
  }

  // CHECK 1: Path coverage must be reasonably high (65%+)
  // Lowered from 80% to account for GPS variance (5-10m typical)
  // Routes with 65%+ match are likely the same journey with GPS noise
  const MIN_GROUPING_PERCENTAGE = 65;
  if (matchPercentage < MIN_GROUPING_PERCENTAGE) {
    return false;
  }

  // CHECK 2: Total distance must be very similar (within 20%)
  // Same journey = nearly identical length
  const maxGroupingDistanceDiff = 0.20;
  const distanceDiff = Math.abs(sig1.distance - sig2.distance);
  const maxDistance = Math.max(sig1.distance, sig2.distance);

  if (maxDistance > 0 && distanceDiff / maxDistance > maxGroupingDistanceDiff) {
    return false;
  }

  // CHECK 3: Endpoints must match closely
  // 200m is strict - really the same start/end location
  const endpointThreshold = loopThreshold * 2; // ~200m

  const start1 = sig1.points[0];
  const end1 = sig1.points[sig1.points.length - 1];
  const start2 = sig2.points[0];
  const end2 = sig2.points[sig2.points.length - 1];

  if (!start1 || !end1 || !start2 || !end2) {
    return false;
  }

  // For loops, check that starts are close and both are actually loops
  if (sig1.isLoop && sig2.isLoop) {
    const startDist = haversineDistance(start1, start2);
    if (startDist > endpointThreshold) {
      return false;
    }
    // Also check middle point for loops
    return checkMiddlePointsMatch(sig1.points, sig2.points, endpointThreshold * 2);
  }

  // Determine direction by checking which endpoint pairing is closer
  const sameStartDist = haversineDistance(start1, start2);
  const sameEndDist = haversineDistance(end1, end2);
  const reverseStartDist = haversineDistance(start1, end2);
  const reverseEndDist = haversineDistance(end1, start2);

  const sameDirectionOk = sameStartDist < endpointThreshold && sameEndDist < endpointThreshold;
  const reverseDirectionOk = reverseStartDist < endpointThreshold && reverseEndDist < endpointThreshold;

  if (!sameDirectionOk && !reverseDirectionOk) {
    return false;
  }

  // CHECK 4: Middle points must also match
  // This prevents routes that share only start/end from being grouped
  // (e.g., runs that start from same place but take different paths)
  const points2ForMiddle = reverseDirectionOk && !sameDirectionOk
    ? [...sig2.points].reverse()
    : sig2.points;

  return checkMiddlePointsMatch(sig1.points, points2ForMiddle, endpointThreshold * 2);
}

/**
 * Check that the middle portions of two routes also match.
 * This prevents grouping routes that only share start/end but diverge in the middle.
 */
function checkMiddlePointsMatch(
  points1: RoutePoint[],
  points2: RoutePoint[],
  threshold: number
): boolean {
  if (points1.length < 5 || points2.length < 5) {
    return true; // Not enough points to check middle
  }

  // Check points at 25%, 50%, and 75% along each route
  const checkPositions = [0.25, 0.5, 0.75];

  for (const pos of checkPositions) {
    const idx1 = Math.floor(points1.length * pos);
    const idx2 = Math.floor(points2.length * pos);

    const p1 = points1[idx1];
    const p2 = points2[idx2];

    if (!p1 || !p2) continue;

    const dist = haversineDistance(p1, p2);
    if (dist > threshold) {
      return false; // Middle point too far apart
    }
  }

  return true;
}

/**
 * Group signatures into route groups based on matching.
 * Returns grouped route IDs using Union-Find.
 *
 * Uses strict grouping criteria - only activities that represent
 * the SAME JOURNEY (not just shared sections) are grouped together.
 */
export function groupSignatures(
  signatures: RouteSignature[],
  config: Partial<RouteMatchConfig> = {}
): Map<string, string[]> {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };

  // Union-find data structure for grouping
  const parent = new Map<string, string>();

  function find(id: string): string {
    if (!parent.has(id)) {
      parent.set(id, id);
      return id;
    }
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(id1: string, id2: string): void {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      parent.set(root2, root1);
    }
  }

  // Compare all pairs (O(n²) but typically n is small after quick filtering)
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const match = matchRoutes(signatures[i], signatures[j], cfg);

      // Only group if match exists AND passes strict grouping criteria
      // This prevents activities with shared sections from being merged
      if (match && shouldGroupRoutes(signatures[i], signatures[j], match.matchPercentage, cfg)) {
        union(signatures[i].activityId, signatures[j].activityId);
      }
    }
  }

  // Build groups - use Set to prevent duplicate activity IDs
  const groupSets = new Map<string, Set<string>>();
  for (const sig of signatures) {
    const root = find(sig.activityId);
    if (!groupSets.has(root)) {
      groupSets.set(root, new Set());
    }
    groupSets.get(root)!.add(sig.activityId);
  }

  // Convert Sets to arrays
  const groups = new Map<string, string[]>();
  for (const [root, idSet] of groupSets) {
    groups.set(root, Array.from(idSet));
  }

  return groups;
}

/**
 * Create a RouteMatch object from match result.
 */
export function createRouteMatch(
  activityId: string,
  routeGroupId: string,
  result: MatchResult
): RouteMatch {
  return {
    activityId,
    routeGroupId,
    matchPercentage: result.matchPercentage,
    direction: result.direction,
    overlapStart: result.direction === 'partial' ? result.overlapStart : undefined,
    overlapEnd: result.direction === 'partial' ? result.overlapEnd : undefined,
    // Always store overlap distance so UI can show matched section length
    overlapDistance: result.overlapDistance,
    confidence: result.confidence,
  };
}

/**
 * Calculate the consensus route from multiple route signatures.
 * The consensus is the "common core" - points that 80%+ of activities pass through.
 * This creates a route that represents the typical path taken, not just one trace.
 *
 * @param signatures All route signatures in the group
 * @param consensusThreshold Minimum % of activities that must pass near a point (default 0.8 = 80%)
 * @param distanceThreshold Maximum distance (meters) to consider a point "nearby"
 */
export function calculateConsensusRoute(
  signatures: RouteSignature[],
  consensusThreshold = 0.8,
  distanceThreshold = 50
): RoutePoint[] {
  if (signatures.length === 0) return [];
  if (signatures.length === 1) return [...signatures[0].points];

  // Find the longest route to use as the base for sampling
  // (Longest route likely covers the most complete path)
  let baseSignature = signatures[0];
  for (const sig of signatures) {
    if (sig.points.length > baseSignature.points.length) {
      baseSignature = sig;
    }
  }

  const basePoints = baseSignature.points;
  const otherSignatures = signatures.filter(s => s.activityId !== baseSignature.activityId);
  const minVotes = Math.ceil(signatures.length * consensusThreshold);

  // For each point in the base route, count how many other routes pass nearby
  const consensusPoints: RoutePoint[] = [];

  for (const basePoint of basePoints) {
    let votes = 1; // Base route always "votes" for its own points

    for (const otherSig of otherSignatures) {
      // Check if any point in the other route is within threshold of this base point
      // Also check reversed route (in case it's run in opposite direction)
      const nearestDist = findNearestPointDistance(basePoint, otherSig.points);
      if (nearestDist <= distanceThreshold) {
        votes++;
      }
    }

    // Keep this point if enough routes pass through it
    if (votes >= minVotes) {
      consensusPoints.push(basePoint);
    }
  }

  // Remove isolated points (small gaps are OK, but single points surrounded by non-consensus are noise)
  return smoothConsensusPoints(consensusPoints, basePoints);
}

/**
 * Find the distance to the nearest point in a route.
 */
function findNearestPointDistance(target: RoutePoint, points: RoutePoint[]): number {
  let minDist = Infinity;
  for (const point of points) {
    const dist = haversineDistance(target, point);
    if (dist < minDist) {
      minDist = dist;
    }
  }
  return minDist;
}

/**
 * Smooth consensus points by removing isolated outliers and cutting artifact gaps.
 *
 * Artifacts occur when:
 * - GPS traces have gaps (device lost signal)
 * - Start/end points don't match, creating long straight lines
 *
 * This function:
 * 1. Removes isolated points (no nearby consensus neighbors)
 * 2. Detects and cuts at large gaps (straight line artifacts)
 * 3. Returns the longest continuous portion
 */
function smoothConsensusPoints(
  consensusPoints: RoutePoint[],
  originalPoints: RoutePoint[]
): RoutePoint[] {
  if (consensusPoints.length <= 2) return consensusPoints;

  // Create a set of consensus point indices for quick lookup
  const consensusIndices = new Set<number>();
  for (const cp of consensusPoints) {
    const idx = originalPoints.findIndex(
      p => p.lat === cp.lat && p.lng === cp.lng
    );
    if (idx >= 0) consensusIndices.add(idx);
  }

  // Keep points that have at least one neighbor also in consensus
  const smoothed: RoutePoint[] = [];
  for (const idx of Array.from(consensusIndices).sort((a, b) => a - b)) {
    const hasNeighbor =
      consensusIndices.has(idx - 1) ||
      consensusIndices.has(idx + 1) ||
      consensusIndices.has(idx - 2) ||
      consensusIndices.has(idx + 2);

    if (hasNeighbor) {
      smoothed.push(originalPoints[idx]);
    }
  }

  // Now detect and cut artifact straight lines
  // An artifact is when consecutive points are much farther apart than typical
  return cutArtifactGaps(smoothed);
}

/**
 * Detect and cut gaps where consecutive points are much farther apart than average.
 * These gaps create artifact straight lines that don't represent real paths.
 * Returns the longest continuous portion.
 */
function cutArtifactGaps(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= 2) return points;

  // Calculate distances between consecutive points
  const distances: number[] = [];
  for (let i = 1; i < points.length; i++) {
    distances.push(haversineDistance(points[i - 1], points[i]));
  }

  // Calculate median distance (more robust than mean for outlier detection)
  const sortedDistances = [...distances].sort((a, b) => a - b);
  const medianIdx = Math.floor(sortedDistances.length / 2);
  const medianDistance = sortedDistances.length % 2 === 0
    ? (sortedDistances[medianIdx - 1] + sortedDistances[medianIdx]) / 2
    : sortedDistances[medianIdx];

  // Gap threshold: Use 5x median distance to catch short artifacts
  // Minimum of 30m to avoid cutting at normal GPS jitter
  // Maximum of 100m to always catch long straight lines
  const gapThreshold = Math.min(
    Math.max(medianDistance * 5, 30),
    100 // Never allow gaps larger than 100m
  );

  // Find all chunks (split at gaps)
  const chunks: RoutePoint[][] = [];
  let currentChunk: RoutePoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    if (distances[i - 1] > gapThreshold) {
      // Gap detected - start new chunk
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
      }
      currentChunk = [points[i]];
    } else {
      currentChunk.push(points[i]);
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  // Return the longest chunk
  if (chunks.length === 0) return points;

  let longestChunk = chunks[0];
  for (const chunk of chunks) {
    if (chunk.length > longestChunk.length) {
      longestChunk = chunk;
    }
  }

  return longestChunk;
}

/**
 * Recalculate consensus for a route group when activities change.
 * Call this when adding/removing activities from a group.
 */
export function updateGroupConsensus(
  groupSignatures: RouteSignature[],
  config: Partial<RouteMatchConfig> = {}
): RoutePoint[] {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };
  return calculateConsensusRoute(
    groupSignatures,
    0.8, // 80% threshold
    cfg.distanceThreshold
  );
}

/**
 * Represents a single lap/pass through a route.
 */
export interface RouteLap {
  /** Lap number (1-indexed) */
  lapNumber: number;
  /** Start index in the activity's GPS trace */
  startIndex: number;
  /** End index in the activity's GPS trace */
  endIndex: number;
  /** Distance covered in this lap (meters) */
  distance: number;
  /** Estimated duration for this lap (seconds) - proportional to distance */
  estimatedDuration: number;
  /** Average speed for this lap (m/s) */
  speed: number;
  /** Direction relative to consensus route */
  direction: 'same' | 'reverse';
  /** Points for this lap */
  points: RoutePoint[];
}

/**
 * Detect laps/passes through a route within a single activity.
 *
 * A "lap" is a continuous portion where the activity trace follows the consensus route.
 * Activities like running 10 laps on an oval will return 10 lap entries.
 *
 * @param activityPoints GPS trace from the activity
 * @param consensusPoints The consensus route to match against
 * @param activityDistance Total activity distance in meters
 * @param activityDuration Total activity moving time in seconds
 * @param distanceThreshold Max distance (meters) to consider "on route"
 * @param minLapDistance Minimum distance (meters) for a valid lap
 */
export function detectLaps(
  activityPoints: RoutePoint[],
  consensusPoints: RoutePoint[],
  activityDistance: number,
  activityDuration: number,
  distanceThreshold = 50,
  minLapDistance = 100
): RouteLap[] {
  // Validate inputs
  if (!activityPoints || !consensusPoints) {
    return [];
  }
  if (activityPoints.length < 3 || consensusPoints.length < 3) {
    return [];
  }
  if (!activityDistance || !activityDuration || activityDuration <= 0) {
    return [];
  }

  // Average speed for the whole activity (used to estimate lap times)
  const avgSpeed = activityDistance / activityDuration;
  if (!isFinite(avgSpeed) || avgSpeed <= 0) {
    return [];
  }

  // For each point in the activity, find if it's "on" the consensus route
  const onRoute: boolean[] = activityPoints.map(point => {
    const nearestDist = findNearestPointDistance(point, consensusPoints);
    return nearestDist <= distanceThreshold;
  });

  // Find continuous ranges that are on the route
  const ranges: { start: number; end: number }[] = [];
  let rangeStart = -1;

  for (let i = 0; i < onRoute.length; i++) {
    if (onRoute[i] && rangeStart === -1) {
      rangeStart = i;
    } else if (!onRoute[i] && rangeStart !== -1) {
      ranges.push({ start: rangeStart, end: i - 1 });
      rangeStart = -1;
    }
  }
  // Don't forget the last range
  if (rangeStart !== -1) {
    ranges.push({ start: rangeStart, end: onRoute.length - 1 });
  }

  // Now determine which ranges are actual "laps" (complete passes through the route)
  // A lap should cover a significant portion of the consensus route
  const consensusLength = calculateRouteDistance(consensusPoints);
  const minLapCoverage = Math.min(minLapDistance, consensusLength * 0.5);

  const laps: RouteLap[] = [];

  for (const range of ranges) {
    const rangePoints = activityPoints.slice(range.start, range.end + 1);
    const rangeDistance = calculateRouteDistance(rangePoints);

    // Skip ranges that are too short to be a lap
    if (rangeDistance < minLapCoverage) continue;

    // Determine direction by comparing start/end of range to consensus
    const rangeStartPt = rangePoints[0];
    const rangeEndPt = rangePoints[rangePoints.length - 1];
    const consensusStart = consensusPoints[0];
    const consensusEnd = consensusPoints[consensusPoints.length - 1];

    const startToStart = haversineDistance(rangeStartPt, consensusStart);
    const startToEnd = haversineDistance(rangeStartPt, consensusEnd);
    const direction: 'same' | 'reverse' = startToStart < startToEnd ? 'same' : 'reverse';

    // Estimate duration based on distance and average speed
    const estimatedDuration = rangeDistance / avgSpeed;

    // Safety check for speed calculation
    const lapSpeed = estimatedDuration > 0 ? rangeDistance / estimatedDuration : avgSpeed;
    if (!isFinite(lapSpeed) || lapSpeed <= 0) continue;

    laps.push({
      lapNumber: laps.length + 1,
      startIndex: range.start,
      endIndex: range.end,
      distance: rangeDistance,
      estimatedDuration,
      speed: lapSpeed,
      direction,
      points: rangePoints,
    });
  }

  // If we have multiple laps that are very close together (< 30m gap),
  // they might be the same lap with a GPS dropout - merge them
  const mergedLaps = mergeLapsWithSmallGaps(laps, activityPoints, 30);

  // Re-number laps after merging
  return mergedLaps.map((lap, idx) => ({
    ...lap,
    lapNumber: idx + 1,
  }));
}

/**
 * Merge laps that have small gaps between them (likely GPS dropouts).
 */
function mergeLapsWithSmallGaps(
  laps: RouteLap[],
  activityPoints: RoutePoint[],
  maxGapDistance: number
): RouteLap[] {
  if (laps.length <= 1) return laps;

  const merged: RouteLap[] = [laps[0]];

  for (let i = 1; i < laps.length; i++) {
    const prevLap = merged[merged.length - 1];
    const currentLap = laps[i];

    // Calculate gap between end of previous and start of current
    const gapPoints = activityPoints.slice(prevLap.endIndex + 1, currentLap.startIndex);
    const gapDistance = gapPoints.length > 0 ? calculateRouteDistance(gapPoints) : 0;

    if (gapDistance <= maxGapDistance) {
      // Merge: extend previous lap to include current
      const combinedPoints = activityPoints.slice(prevLap.startIndex, currentLap.endIndex + 1);
      const combinedDistance = calculateRouteDistance(combinedPoints);
      const combinedDuration = prevLap.estimatedDuration + currentLap.estimatedDuration;

      merged[merged.length - 1] = {
        ...prevLap,
        endIndex: currentLap.endIndex,
        distance: combinedDistance,
        estimatedDuration: combinedDuration,
        speed: combinedDistance / combinedDuration,
        points: combinedPoints,
      };
    } else {
      merged.push(currentLap);
    }
  }

  return merged;
}

/**
 * Detect all laps for activities in a route group.
 * Returns a map from activityId to array of laps.
 */
export function detectLapsForGroup(
  signatures: Record<string, RouteSignature>,
  consensusPoints: RoutePoint[],
  activityData: Record<string, { distance: number; duration: number }>,
  distanceThreshold = 50
): Record<string, RouteLap[]> {
  const result: Record<string, RouteLap[]> = {};

  for (const [activityId, signature] of Object.entries(signatures)) {
    const data = activityData[activityId];
    if (!data || !signature.points || signature.points.length < 3) {
      result[activityId] = [];
      continue;
    }

    result[activityId] = detectLaps(
      signature.points,
      consensusPoints,
      data.distance,
      data.duration,
      distanceThreshold
    );
  }

  return result;
}
