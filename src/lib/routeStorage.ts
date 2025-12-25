/**
 * Route matching AsyncStorage operations.
 * Handles persistence of signatures, groups, and matches.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  RouteSignature,
  RouteGroup,
  RouteMatch,
  RouteMatchCache,
  ActivityType,
  RoutePoint,
} from '@/types';
import { matchRoutes, calculateConsensusRoute } from './routeMatching';

// Storage keys
const ROUTE_CACHE_KEY = 'veloq_route_match_cache';
const ROUTE_CACHE_VERSION = 1;
const CUSTOM_ROUTE_NAMES_KEY = 'veloq_custom_route_names';

// In-memory cache for custom route names
let customRouteNamesCache: Record<string, string> | null = null;

/**
 * Load custom route names from storage.
 * These persist separately from the route cache so they survive cache clears.
 */
export async function loadCustomRouteNames(): Promise<Record<string, string>> {
  if (customRouteNamesCache !== null) {
    return customRouteNamesCache;
  }

  try {
    const stored = await AsyncStorage.getItem(CUSTOM_ROUTE_NAMES_KEY);
    if (stored) {
      customRouteNamesCache = JSON.parse(stored);
      return customRouteNamesCache!;
    }
  } catch {
    // Ignore errors
  }

  customRouteNamesCache = {};
  return customRouteNamesCache;
}

/**
 * Save a custom route name.
 * Pass null to remove the custom name (reverts to auto-generated name).
 */
export async function saveCustomRouteName(
  routeId: string,
  name: string | null
): Promise<void> {
  const names = await loadCustomRouteNames();

  if (name === null) {
    delete names[routeId];
  } else {
    names[routeId] = name;
  }

  customRouteNamesCache = names;

  try {
    await AsyncStorage.setItem(CUSTOM_ROUTE_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Ignore save errors
  }
}

/**
 * Get the display name for a route.
 * Returns custom name if set, otherwise the auto-generated name.
 */
export function getRouteDisplayName(
  routeId: string,
  autoName: string
): string {
  if (customRouteNamesCache && customRouteNamesCache[routeId]) {
    return customRouteNamesCache[routeId];
  }
  return autoName;
}

/**
 * Check if a route has a custom name set.
 */
export function hasCustomRouteName(routeId: string): boolean {
  return !!(customRouteNamesCache && customRouteNamesCache[routeId]);
}

/**
 * Load route match cache from storage.
 */
export async function loadRouteCache(): Promise<RouteMatchCache | null> {
  try {
    const cached = await AsyncStorage.getItem(ROUTE_CACHE_KEY);
    if (!cached) return null;

    const data: RouteMatchCache = JSON.parse(cached);

    // Version check - if outdated, return null to force rebuild
    if (data.version !== ROUTE_CACHE_VERSION) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Save route match cache to storage.
 */
export async function saveRouteCache(cache: RouteMatchCache): Promise<void> {
  try {
    await AsyncStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Silently fail - storage is not critical
  }
}

/**
 * Clear route match cache.
 */
export async function clearRouteCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ROUTE_CACHE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Create an empty route match cache.
 */
export function createEmptyCache(): RouteMatchCache {
  return {
    version: ROUTE_CACHE_VERSION,
    lastUpdated: new Date().toISOString(),
    signatures: {},
    groups: [],
    matches: {},
    processedActivityIds: [],
    activityToRouteId: {},
  };
}

/**
 * Add a signature to the cache.
 */
export function addSignatureToCache(
  cache: RouteMatchCache,
  signature: RouteSignature
): RouteMatchCache {
  return {
    ...cache,
    signatures: {
      ...cache.signatures,
      [signature.activityId]: signature,
    },
    processedActivityIds: cache.processedActivityIds.includes(signature.activityId)
      ? cache.processedActivityIds
      : [...cache.processedActivityIds, signature.activityId],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Add multiple signatures to the cache.
 */
export function addSignaturesToCache(
  cache: RouteMatchCache,
  signatures: RouteSignature[]
): RouteMatchCache {
  const newSignatures = { ...cache.signatures };
  const newProcessedIds = new Set(cache.processedActivityIds);

  for (const sig of signatures) {
    newSignatures[sig.activityId] = sig;
    newProcessedIds.add(sig.activityId);
  }

  return {
    ...cache,
    signatures: newSignatures,
    processedActivityIds: Array.from(newProcessedIds),
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Generate a stable route group ID based on the representative activity.
 * Using the activity ID ensures the same group keeps the same ID across re-processing.
 */
function generateGroupId(representativeActivityId: string): string {
  return `route_${representativeActivityId}`;
}

/**
 * Create a new route group from a set of activity IDs.
 * Calculates the consensus route - the common core that 80%+ of activities share.
 */
export function createRouteGroup(
  activityIds: string[],
  signatures: Record<string, RouteSignature>,
  activityMetadata: Record<string, { name: string; date: string; type: ActivityType }>
): RouteGroup {
  // Use the first activity's signature as representative
  const representativeId = activityIds[0];
  const signature = signatures[representativeId];

  // Get dates for all activities
  const dates = activityIds
    .map((id) => activityMetadata[id]?.date)
    .filter(Boolean)
    .sort();

  // Get activity type from first activity
  const type = activityMetadata[representativeId]?.type || 'Run';

  // Generate name from first activity or locality
  let name = activityMetadata[representativeId]?.name || 'Unknown Route';
  // Try to extract a meaningful name (remove date prefixes, etc.)
  if (name.includes(' - ')) {
    name = name.split(' - ').pop() || name;
  }

  // Calculate consensus route from all signatures in the group
  // This is the "common core" that 80%+ of activities pass through
  const groupSignatures = activityIds
    .map(id => signatures[id])
    .filter((sig): sig is RouteSignature => sig != null);

  let consensusPoints: RoutePoint[] | undefined;
  if (groupSignatures.length >= 2) {
    consensusPoints = calculateConsensusRoute(groupSignatures);
    // Only keep if we have a meaningful consensus (at least 10 points)
    if (consensusPoints.length < 10) {
      consensusPoints = undefined;
    }
  }

  return {
    id: generateGroupId(representativeId),
    name,
    signature,
    consensusPoints,
    activityIds,
    activityCount: activityIds.length,
    firstDate: dates[0] || new Date().toISOString(),
    lastDate: dates[dates.length - 1] || new Date().toISOString(),
    type,
    averageMatchQuality: 100, // Will be updated when matches are calculated
  };
}

/**
 * Update route groups with new groupings.
 * Calculates actual match percentages for each activity against the representative.
 */
export function updateRouteGroups(
  cache: RouteMatchCache,
  groupedIds: Map<string, string[]>,
  activityMetadata: Record<string, { name: string; date: string; type: ActivityType }>
): RouteMatchCache {
  const newGroups: RouteGroup[] = [];
  const newMatches: Record<string, RouteMatch> = { ...cache.matches };
  const newActivityToRouteId: Record<string, string> = {};

  for (const [, activityIds] of groupedIds) {
    if (activityIds.length === 0) continue;

    // Create or update group
    const group = createRouteGroup(activityIds, cache.signatures, activityMetadata);
    newGroups.push(group);

    // Get the representative signature (first activity)
    const representativeId = activityIds[0];
    const representativeSignature = cache.signatures[representativeId];

    // Track match percentages for calculating average
    const matchPercentages: number[] = [];

    // Create matches and reverse index for all activities in group
    for (const activityId of activityIds) {
      // Add to reverse index (all activities, including representative)
      newActivityToRouteId[activityId] = group.id;

      // Skip the representative (first) activity for matches
      if (activityId === representativeId) continue;

      // Get the signature for this activity
      const signature = cache.signatures[activityId];

      // Calculate actual match against representative
      let matchPercentage = 100;
      let direction: 'same' | 'reverse' | 'partial' = 'same';
      let confidence = 1;

      if (signature && representativeSignature) {
        const match = matchRoutes(signature, representativeSignature);
        if (match) {
          matchPercentage = match.matchPercentage;
          direction = match.direction;
          confidence = match.confidence;
          matchPercentages.push(matchPercentage);
        }
      }

      newMatches[activityId] = {
        activityId,
        routeGroupId: group.id,
        matchPercentage,
        direction,
        confidence,
      };
    }

    // Update group's average match quality
    if (matchPercentages.length > 0) {
      group.averageMatchQuality = Math.round(
        matchPercentages.reduce((a, b) => a + b, 0) / matchPercentages.length
      );
    }
  }

  return {
    ...cache,
    groups: newGroups,
    matches: newMatches,
    activityToRouteId: newActivityToRouteId,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Add a match to the cache.
 */
export function addMatchToCache(
  cache: RouteMatchCache,
  match: RouteMatch
): RouteMatchCache {
  return {
    ...cache,
    matches: {
      ...cache.matches,
      [match.activityId]: match,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Get signature for an activity.
 */
export function getSignature(
  cache: RouteMatchCache,
  activityId: string
): RouteSignature | null {
  return cache.signatures[activityId] || null;
}

/**
 * Get match for an activity.
 */
export function getMatch(
  cache: RouteMatchCache,
  activityId: string
): RouteMatch | null {
  return cache.matches[activityId] || null;
}

/**
 * Get route group by ID.
 */
export function getRouteGroup(
  cache: RouteMatchCache,
  groupId: string
): RouteGroup | null {
  return cache.groups.find((g) => g.id === groupId) || null;
}

/**
 * Get route group for an activity.
 */
export function getRouteGroupForActivity(
  cache: RouteMatchCache,
  activityId: string
): RouteGroup | null {
  const match = cache.matches[activityId];
  if (!match) return null;
  return getRouteGroup(cache, match.routeGroupId);
}

/**
 * Get all activity IDs that need processing.
 */
export function getUnprocessedActivityIds(
  cache: RouteMatchCache,
  allActivityIds: string[]
): string[] {
  const processedSet = new Set(cache.processedActivityIds);
  return allActivityIds.filter((id) => !processedSet.has(id));
}

/**
 * Calculate cache statistics.
 */
export function getCacheStats(cache: RouteMatchCache): {
  totalSignatures: number;
  totalGroups: number;
  totalMatches: number;
  processedCount: number;
  lastUpdated: string;
} {
  return {
    totalSignatures: Object.keys(cache.signatures).length,
    totalGroups: cache.groups.length,
    totalMatches: Object.keys(cache.matches).length,
    processedCount: cache.processedActivityIds.length,
    lastUpdated: cache.lastUpdated,
  };
}
