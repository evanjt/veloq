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

  // Find continuous matched sections
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
  // This ensures a small route can't claim 100% match with a longer route
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
  if (bestResult.matchPercentage >= 85 && bestResult.frechetScore >= 70) {
    // High match AND good shape similarity = same/reverse
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
      // Higher threshold for grouping - routes must be very similar
      if (match && match.matchPercentage >= 70 && match.direction !== 'partial') {
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
    overlapDistance: result.direction === 'partial' ? result.overlapDistance : undefined,
    confidence: result.confidence,
  };
}
