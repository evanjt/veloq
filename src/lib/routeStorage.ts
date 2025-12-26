/**
 * Route matching storage operations.
 * Handles persistence of signatures, groups, and matches.
 * Uses FileSystem instead of AsyncStorage to avoid SQLite size limits.
 */

import * as FileSystem from 'expo-file-system/legacy';
import type {
  RouteSignature,
  RouteGroup,
  RouteMatch,
  RouteMatchCache,
  ActivityType,
  RoutePoint,
} from '@/types';
import { getGpsTrack } from './gpsStorage';
import { matchRoutes, calculateConsensusRoute } from './routeMatching';
import { debug } from './debug';

const log = debug.create('RouteStorage');

// Storage paths (FileSystem-based)
const ROUTE_DIR = `${FileSystem.documentDirectory}route_cache/`;
const ROUTE_CACHE_FILE = `${ROUTE_DIR}cache.json`;
const CUSTOM_NAMES_FILE = `${ROUTE_DIR}custom_names.json`;
const ROUTE_CACHE_VERSION = 1;

/** Ensure the route cache directory exists */
async function ensureRouteDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(ROUTE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(ROUTE_DIR, { intermediates: true });
    log.log('Created route cache directory');
  }
}

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
    await ensureRouteDir();
    const info = await FileSystem.getInfoAsync(CUSTOM_NAMES_FILE);
    if (info.exists) {
      const stored = await FileSystem.readAsStringAsync(CUSTOM_NAMES_FILE);
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
    await ensureRouteDir();
    await FileSystem.writeAsStringAsync(CUSTOM_NAMES_FILE, JSON.stringify(names));
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
 * Note: Points are stripped from signatures to save space.
 * Use restoreSignaturePoints() to regenerate them from GPS cache when needed.
 */
export async function loadRouteCache(): Promise<RouteMatchCache | null> {
  try {
    await ensureRouteDir();
    const info = await FileSystem.getInfoAsync(ROUTE_CACHE_FILE);
    if (!info.exists) {
      log.log('No route cache found');
      return null;
    }

    const cached = await FileSystem.readAsStringAsync(ROUTE_CACHE_FILE);
    log.log(`Loading route cache: ${cached.length} bytes`);
    const data: RouteMatchCache = JSON.parse(cached);

    // Version check - if outdated, return null to force rebuild
    if (data.version !== ROUTE_CACHE_VERSION) {
      log.log(`Cache version mismatch: ${data.version} vs ${ROUTE_CACHE_VERSION}`);
      return null;
    }

    log.log(`Loaded ${data.processedActivityIds.length} processed activities, ${data.groups.length} groups`);
    return data;
  } catch (error) {
    log.error('Failed to load route cache:', error);
    return null;
  }
}

/**
 * Restore points to a signature from GPS cache.
 * Returns the signature with points populated, or null if GPS data not available.
 */
export async function restoreSignaturePoints(
  signature: RouteSignature,
  getGpsTrack: (activityId: string) => Promise<[number, number][] | null>
): Promise<RouteSignature | null> {
  // If already has points, return as-is
  if (signature.points && signature.points.length > 0) {
    return signature;
  }

  // Try to get GPS data from cache
  const latlngs = await getGpsTrack(signature.activityId);
  if (!latlngs || latlngs.length < 2) {
    return null;
  }

  // Regenerate simplified points (similar to signature creation)
  // Use a simple sampling approach for display purposes
  const sampleStep = Math.max(1, Math.floor(latlngs.length / 100));
  const points: RoutePoint[] = [];

  for (let i = 0; i < latlngs.length; i += sampleStep) {
    const [lat, lng] = latlngs[i];
    points.push({ lat, lng });
  }

  // Ensure we include the last point
  const lastPoint = latlngs[latlngs.length - 1];
  if (points.length === 0 || points[points.length - 1].lat !== lastPoint[0]) {
    points.push({ lat: lastPoint[0], lng: lastPoint[1] });
  }

  return {
    ...signature,
    points,
  };
}

/**
 * Restore points to a route group's signature from GPS cache.
 */
export async function restoreGroupSignaturePoints(
  group: RouteGroup,
  getGpsTrack: (activityId: string) => Promise<[number, number][] | null>
): Promise<RouteGroup> {
  if (group.signature.points && group.signature.points.length > 0) {
    return group;
  }

  const restoredSig = await restoreSignaturePoints(group.signature, getGpsTrack);
  if (restoredSig) {
    return {
      ...group,
      signature: restoredSig,
    };
  }

  return group;
}

/**
 * Create a storage-optimized version of the cache by stripping large point arrays.
 * Points can be regenerated from GPS data when needed.
 */
function createLiteCache(cache: RouteMatchCache): RouteMatchCache {
  // Strip points from signatures (keep metadata only)
  const liteSignatures: Record<string, RouteSignature> = {};
  for (const [id, sig] of Object.entries(cache.signatures)) {
    liteSignatures[id] = {
      ...sig,
      points: [], // Strip points - can regenerate from GPS
    };
  }

  // Strip points from groups (keep metadata only)
  const liteGroups = cache.groups.map(group => ({
    ...group,
    signature: {
      ...group.signature,
      points: [], // Strip points
    },
    consensusPoints: undefined, // Strip consensus points
  }));

  return {
    ...cache,
    signatures: liteSignatures,
    groups: liteGroups,
  };
}

/**
 * Save route match cache to storage.
 * Strips large point arrays to reduce size (475KB → ~50KB).
 */
export async function saveRouteCache(cache: RouteMatchCache): Promise<void> {
  try {
    await ensureRouteDir();
    // Create lite version for storage
    const liteCache = createLiteCache(cache);
    const data = JSON.stringify(liteCache);
    log.log(`Saving route cache: ${data.length} bytes (lite), ${cache.processedActivityIds.length} activities, ${cache.groups.length} groups`);
    await FileSystem.writeAsStringAsync(ROUTE_CACHE_FILE, data);
  } catch (error) {
    log.error('Failed to save route cache:', error);
  }
}

/**
 * Clear route match cache.
 */
export async function clearRouteCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(ROUTE_CACHE_FILE);
    if (info.exists) {
      await FileSystem.deleteAsync(ROUTE_CACHE_FILE, { idempotent: true });
      log.log('Cleared route cache');
    }
  } catch {
    // Silently fail
  }
}

/**
 * Estimate route cache size in bytes.
 */
export async function estimateRouteCacheSize(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(ROUTE_CACHE_FILE);
    if (info.exists && 'size' in info) {
      return info.size || 0;
    }
  } catch {
    // Ignore
  }
  return 0;
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
 * Mark activities as processed (even if they failed to generate signatures).
 * This prevents them from being re-processed on every app launch.
 */
export function markActivitiesAsProcessed(
  cache: RouteMatchCache,
  activityIds: string[]
): RouteMatchCache {
  const newProcessedIds = new Set(cache.processedActivityIds);
  for (const id of activityIds) {
    newProcessedIds.add(id);
  }
  return {
    ...cache,
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
