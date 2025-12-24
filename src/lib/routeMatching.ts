/**
 * Route matching algorithm using Dynamic Time Warping (DTW).
 * Handles forward, reverse, and partial matches with proper similarity calculation.
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
 * Dynamic Time Warping distance between two route sequences.
 * Uses haversine distance as the point-to-point cost.
 *
 * DTW finds the optimal alignment between two sequences that may:
 * - Have different lengths
 * - Have different speeds/sampling rates
 * - Have GPS jitter
 *
 * Returns the normalized DTW distance (lower = more similar).
 */
function dtwDistance(
  route1: RoutePoint[],
  route2: RoutePoint[],
  maxPointDistance: number
): { distance: number; path: [number, number][] } {
  const n = route1.length;
  const m = route2.length;

  if (n === 0 || m === 0) {
    return { distance: Infinity, path: [] };
  }

  // Create cost matrix with infinity initialization
  const dtw: number[][] = Array(n + 1)
    .fill(null)
    .map(() => Array(m + 1).fill(Infinity));

  dtw[0][0] = 0;

  // Fill the DTW matrix
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const pointDist = haversineDistance(route1[i - 1], route2[j - 1]);

      // Penalize large distances exponentially but cap at maxPointDistance
      const cost = Math.min(pointDist, maxPointDistance);

      dtw[i][j] = cost + Math.min(
        dtw[i - 1][j],     // insertion (skip point in route1)
        dtw[i][j - 1],     // deletion (skip point in route2)
        dtw[i - 1][j - 1]  // match
      );
    }
  }

  // Backtrack to find the optimal path
  const path: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    path.unshift([i - 1, j - 1]);
    const candidates = [
      { val: dtw[i - 1][j - 1], ni: i - 1, nj: j - 1 },
      { val: dtw[i - 1][j], ni: i - 1, nj: j },
      { val: dtw[i][j - 1], ni: i, nj: j - 1 },
    ];
    candidates.sort((a, b) => a.val - b.val);
    i = candidates[0].ni;
    j = candidates[0].nj;
  }

  // Normalize by path length
  const normalizedDistance = dtw[n][m] / path.length;

  return { distance: normalizedDistance, path };
}

/**
 * Calculate what percentage of route1 is covered by the DTW alignment.
 * This gives us the match quality from route1's perspective.
 */
function calculateCoverageFromPath(
  route1: RoutePoint[],
  route2: RoutePoint[],
  path: [number, number][],
  distanceThreshold: number
): {
  matchedPoints: number;
  totalPoints: number;
  matchedDistance: number;
  matchedRanges: { start: number; end: number }[];
} {
  const n = route1.length;
  const matched = new Array(n).fill(false);

  // Mark points in route1 that have close matches via the DTW path
  for (const [i, j] of path) {
    if (i < n && j < route2.length) {
      const dist = haversineDistance(route1[i], route2[j]);
      if (dist <= distanceThreshold) {
        matched[i] = true;
      }
    }
  }

  // Find continuous matched ranges
  const matchedRanges: { start: number; end: number }[] = [];
  let rangeStart = -1;

  for (let i = 0; i < matched.length; i++) {
    if (matched[i] && rangeStart === -1) {
      rangeStart = i;
    } else if (!matched[i] && rangeStart !== -1) {
      matchedRanges.push({ start: rangeStart, end: i - 1 });
      rangeStart = -1;
    }
  }
  if (rangeStart !== -1) {
    matchedRanges.push({ start: rangeStart, end: matched.length - 1 });
  }

  // Calculate matched distance
  let matchedDistance = 0;
  for (const range of matchedRanges) {
    const rangePoints = route1.slice(range.start, range.end + 1);
    matchedDistance += calculateRouteDistance(rangePoints);
  }

  return {
    matchedPoints: matched.filter(Boolean).length,
    totalPoints: n,
    matchedDistance,
    matchedRanges,
  };
}

/**
 * Fréchet distance-inspired similarity score.
 * Measures the maximum distance between aligned points.
 * Lower Fréchet = routes are more similar in shape.
 */
function frechetSimilarity(
  route1: RoutePoint[],
  route2: RoutePoint[],
  path: [number, number][],
  maxDistance: number
): number {
  if (path.length === 0) return 0;

  let maxAlignedDist = 0;
  for (const [i, j] of path) {
    const dist = haversineDistance(route1[i], route2[j]);
    if (dist > maxAlignedDist) {
      maxAlignedDist = dist;
    }
  }

  // Convert to 0-100 score: 100 = identical, 0 = completely different
  return Math.max(0, 100 * (1 - maxAlignedDist / maxDistance));
}

/**
 * Compare two route signatures using DTW.
 * Returns match statistics from both perspectives.
 */
function compareRoutesWithDTW(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: RouteMatchConfig
): {
  matchPercentage: number;
  overlapStart: number;
  overlapEnd: number;
  overlapDistance: number;
  confidence: number;
  frechetScore: number;
} {
  const { distanceThreshold } = config;

  // Run DTW
  const { distance: dtwDist, path } = dtwDistance(
    sig1.points,
    sig2.points,
    distanceThreshold * 3 // Allow some slack in DTW alignment
  );

  // Calculate coverage from both perspectives
  const coverage1 = calculateCoverageFromPath(
    sig1.points,
    sig2.points,
    path,
    distanceThreshold
  );

  const coverage2 = calculateCoverageFromPath(
    sig2.points,
    sig1.points,
    path.map(([i, j]) => [j, i] as [number, number]), // Reverse perspective
    distanceThreshold
  );

  // Match percentage: use the MINIMUM of both coverages
  // This ensures a short route can't claim 100% match with a longer route
  const pct1 = coverage1.totalPoints > 0
    ? (coverage1.matchedPoints / coverage1.totalPoints) * 100
    : 0;
  const pct2 = coverage2.totalPoints > 0
    ? (coverage2.matchedPoints / coverage2.totalPoints) * 100
    : 0;

  // Use minimum to prevent small routes from inflating match percentage
  const matchPercentage = Math.min(pct1, pct2);

  // Calculate overlap position
  let overlapStart = 0;
  let overlapEnd = 100;
  if (coverage1.matchedRanges.length > 0) {
    const first = coverage1.matchedRanges[0];
    const last = coverage1.matchedRanges[coverage1.matchedRanges.length - 1];
    overlapStart = (first.start / coverage1.totalPoints) * 100;
    overlapEnd = ((last.end + 1) / coverage1.totalPoints) * 100;
  }

  // Overlap distance
  const overlapDistance = Math.max(coverage1.matchedDistance, coverage2.matchedDistance);

  // Fréchet-inspired shape similarity
  const frechetScore = frechetSimilarity(
    sig1.points,
    sig2.points,
    path,
    distanceThreshold * 5
  );

  // Confidence based on:
  // - Point density
  // - Range continuity
  // - DTW alignment quality
  const minPoints = Math.min(sig1.points.length, sig2.points.length);
  const pointDensityScore = Math.min(1, minPoints / 30);
  const gapPenalty = coverage1.matchedRanges.length > 2
    ? 0.1 * (coverage1.matchedRanges.length - 1)
    : 0;
  const dtwQuality = dtwDist < distanceThreshold ? 1 : Math.max(0, 1 - (dtwDist / (distanceThreshold * 3)));

  const confidence = Math.max(0, (pointDensityScore + dtwQuality) / 2 - gapPenalty);

  return {
    matchPercentage,
    overlapStart,
    overlapEnd,
    overlapDistance,
    confidence,
    frechetScore,
  };
}

/**
 * Match two route signatures, checking both forward and reverse directions.
 * Returns the best match result using DTW algorithm.
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

  // Compare in same direction
  const sameResult = compareRoutesWithDTW(sig1, sig2, cfg);

  // Compare in reverse direction
  const reversedSig2 = reverseSignature(sig2);
  const reverseResult = compareRoutesWithDTW(sig1, reversedSig2, cfg);

  // Determine which is better
  const useSame = sameResult.matchPercentage >= reverseResult.matchPercentage;
  const bestResult = useSame ? sameResult : reverseResult;

  // Check if meets minimum threshold
  if (bestResult.matchPercentage < cfg.minMatchPercentage) {
    return null;
  }

  // Determine direction type
  let direction: MatchDirection;
  if (bestResult.matchPercentage >= 75 && bestResult.frechetScore >= 50) {
    // Good match AND reasonable shape similarity = same/reverse
    direction = useSame ? 'same' : 'reverse';
  } else {
    direction = 'partial';
  }

  return {
    matchPercentage: Math.round(bestResult.matchPercentage),
    direction,
    overlapStart: bestResult.overlapStart,
    overlapEnd: bestResult.overlapEnd,
    overlapDistance: bestResult.overlapDistance,
    confidence: bestResult.confidence,
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
 * Group signatures into route groups based on matching.
 * Returns grouped route IDs using Union-Find.
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
      // Group routes that meet the minimum match threshold
      // Include partial matches - they're still the same route, just with some deviation
      if (match && match.matchPercentage >= cfg.minMatchPercentage) {
        union(signatures[i].activityId, signatures[j].activityId);
      }
    }
  }

  // Build groups
  const groups = new Map<string, string[]>();
  for (const sig of signatures) {
    const root = find(sig.activityId);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(sig.activityId);
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
