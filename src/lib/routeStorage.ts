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
} from '@/types';

// Storage keys
const ROUTE_CACHE_KEY = 'veloq_route_match_cache';
const ROUTE_CACHE_VERSION = 1;

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
 * Generate a unique route group ID.
 */
function generateGroupId(): string {
  return `route_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new route group from a set of activity IDs.
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

  return {
    id: generateGroupId(),
    name,
    signature,
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
 */
export function updateRouteGroups(
  cache: RouteMatchCache,
  groupedIds: Map<string, string[]>,
  activityMetadata: Record<string, { name: string; date: string; type: ActivityType }>
): RouteMatchCache {
  const newGroups: RouteGroup[] = [];
  const newMatches: Record<string, RouteMatch> = { ...cache.matches };

  for (const [, activityIds] of groupedIds) {
    if (activityIds.length === 0) continue;

    // Create or update group
    const group = createRouteGroup(activityIds, cache.signatures, activityMetadata);
    newGroups.push(group);

    // Create matches for all activities in group
    for (const activityId of activityIds) {
      // Skip the representative (first) activity
      if (activityId === activityIds[0]) continue;

      newMatches[activityId] = {
        activityId,
        routeGroupId: group.id,
        matchPercentage: 100, // Will be refined when detailed match is done
        direction: 'same',
        confidence: 1,
      };
    }
  }

  return {
    ...cache,
    groups: newGroups,
    matches: newMatches,
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
