/**
 * Route matching algorithm for comparing GPS routes.
 * Handles forward, reverse, and partial matches.
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
 * Find the nearest point on a route to a given point.
 * Returns the index and distance.
 */
function findNearestPoint(
  point: RoutePoint,
  route: RoutePoint[]
): { index: number; distance: number } {
  let minDistance = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < route.length; i++) {
    const dist = haversineDistance(point, route[i]);
    if (dist < minDistance) {
      minDistance = dist;
      nearestIndex = i;
    }
  }

  return { index: nearestIndex, distance: minDistance };
}

/**
 * Walk along route1 and find matching ranges on route2.
 * Returns match statistics.
 */
function walkAndMatch(
  route1: RoutePoint[],
  route2: RoutePoint[],
  distanceThreshold: number
): {
  matchedCount: number;
  totalPoints: number;
  matchedRanges: Array<{ start: number; end: number }>;
  totalMatchedDistance: number;
} {
  const matchedIndices: boolean[] = new Array(route1.length).fill(false);
  const route1Distance = calculateRouteDistance(route1);

  // For each point in route1, check if there's a nearby point in route2
  for (let i = 0; i < route1.length; i++) {
    const { distance } = findNearestPoint(route1[i], route2);
    if (distance <= distanceThreshold) {
      matchedIndices[i] = true;
    }
  }

  // Find continuous matched sections
  const matchedRanges: Array<{ start: number; end: number }> = [];
  let rangeStart = -1;

  for (let i = 0; i < matchedIndices.length; i++) {
    if (matchedIndices[i] && rangeStart === -1) {
      rangeStart = i;
    } else if (!matchedIndices[i] && rangeStart !== -1) {
      matchedRanges.push({ start: rangeStart, end: i - 1 });
      rangeStart = -1;
    }
  }

  // Close final range if needed
  if (rangeStart !== -1) {
    matchedRanges.push({ start: rangeStart, end: matchedIndices.length - 1 });
  }

  // Calculate matched distance
  let totalMatchedDistance = 0;
  for (const range of matchedRanges) {
    const rangePoints = route1.slice(range.start, range.end + 1);
    totalMatchedDistance += calculateRouteDistance(rangePoints);
  }

  const matchedCount = matchedIndices.filter(Boolean).length;

  return {
    matchedCount,
    totalPoints: route1.length,
    matchedRanges,
    totalMatchedDistance,
  };
}

/**
 * Compare two route signatures in one direction.
 * Returns match statistics.
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

  // Walk sig1 and find matches on sig2
  const result1 = walkAndMatch(sig1.points, sig2.points, distanceThreshold);

  // Walk sig2 and find matches on sig1 (bidirectional check)
  const result2 = walkAndMatch(sig2.points, sig1.points, distanceThreshold);

  // Calculate match percentages from each perspective
  const matchPct1 = result1.totalPoints > 0
    ? (result1.matchedCount / result1.totalPoints) * 100
    : 0;
  const matchPct2 = result2.totalPoints > 0
    ? (result2.matchedCount / result2.totalPoints) * 100
    : 0;

  // Use MINIMUM to ensure both routes mostly overlap
  // This prevents a small route from matching 100% when it's only a fraction of the other route
  // For truly matching routes, both should be high
  const matchPercentage = Math.min(matchPct1, matchPct2);

  // Calculate overlap position (as percentage along the route)
  let overlapStart = 0;
  let overlapEnd = 100;
  if (result1.matchedRanges.length > 0) {
    const firstRange = result1.matchedRanges[0];
    const lastRange = result1.matchedRanges[result1.matchedRanges.length - 1];
    overlapStart = (firstRange.start / result1.totalPoints) * 100;
    overlapEnd = ((lastRange.end + 1) / result1.totalPoints) * 100;
  }

  // Use the larger matched distance
  const overlapDistance = Math.max(result1.totalMatchedDistance, result2.totalMatchedDistance);

  // Confidence based on:
  // - Point density (more points = more confident)
  // - Consistency of matching (fewer gaps = more confident)
  const pointDensityScore = Math.min(1, sig1.points.length / 50);
  const gapPenalty = result1.matchedRanges.length > 1
    ? 0.1 * (result1.matchedRanges.length - 1)
    : 0;
  const confidence = Math.max(0, pointDensityScore - gapPenalty);

  return {
    matchPercentage,
    overlapStart,
    overlapEnd,
    overlapDistance,
    confidence,
  };
}

/**
 * Match two route signatures, checking both forward and reverse directions.
 * Returns the best match result.
 */
export function matchRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: Partial<RouteMatchConfig> = {}
): MatchResult | null {
  const cfg = { ...DEFAULT_ROUTE_MATCH_CONFIG, ...config };

  // Quick filter first
  if (!quickFilterMatch(sig1, sig2, cfg)) {
    return null;
  }

  // Compare in same direction
  const sameResult = compareRoutes(sig1, sig2, cfg);

  // Compare in reverse direction
  const reversedSig2 = reverseSignature(sig2);
  const reverseResult = compareRoutes(sig1, reversedSig2, cfg);

  // Determine which is better
  const useSame = sameResult.matchPercentage >= reverseResult.matchPercentage;
  const bestResult = useSame ? sameResult : reverseResult;

  // Check if meets minimum threshold
  if (bestResult.matchPercentage < cfg.minMatchPercentage) {
    return null;
  }

  // Determine direction type
  let direction: MatchDirection;
  if (bestResult.matchPercentage >= 90) {
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
 * Returns grouped route IDs.
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
      if (match && match.matchPercentage >= 75) { // Higher threshold for grouping
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
