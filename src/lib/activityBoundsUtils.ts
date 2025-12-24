import type { Activity, ActivityBoundsItem, ActivityBoundsCache, ActivityType } from '@/types';
import { activitySpatialIndex } from './spatialIndex';

/** Bounds type: [[minLat, minLng], [maxLat, maxLng]] */
type Bounds = [[number, number], [number, number]];

/**
 * Build a cache entry from an activity and its map bounds
 */
export function buildCacheEntry(
  activity: Activity,
  bounds: Bounds
): ActivityBoundsItem {
  return {
    id: activity.id,
    bounds,
    type: activity.type as ActivityType,
    name: activity.name,
    date: activity.start_date_local,
    distance: activity.distance || 0,
    duration: activity.moving_time || 0,
  };
}

/**
 * Filter activities to only those with GPS data
 */
export function filterGpsActivities(activities: Activity[]): Activity[] {
  return activities.filter((a) => a.stream_types?.includes('latlng'));
}

/**
 * Filter out activities that are already in the cache
 */
export function filterUncachedActivities(
  activities: Activity[],
  cache: ActivityBoundsCache | null
): Activity[] {
  const existingIds = new Set(Object.keys(cache?.activities || {}));
  return activities.filter((a) => !existingIds.has(a.id));
}

/**
 * Calculate the oldest date from a set of activities
 */
export function findOldestDate(activities: Record<string, ActivityBoundsItem>): string | null {
  const entries = Object.values(activities);
  if (entries.length === 0) return null;
  return entries.reduce((oldest, a) => (a.date < oldest ? a.date : oldest), entries[0].date);
}

/**
 * Calculate the newest date from a set of activities
 */
export function findNewestDate(activities: Record<string, ActivityBoundsItem>): string | null {
  const entries = Object.values(activities);
  if (entries.length === 0) return null;
  return entries.reduce((newest, a) => (a.date > newest ? a.date : newest), entries[0].date);
}

/**
 * Merge new entries into existing cache
 */
export function mergeCacheEntries(
  existingCache: ActivityBoundsCache | null,
  newEntries: Record<string, ActivityBoundsItem>,
  lastSync: string,
  oldest: string
): ActivityBoundsCache {
  const allEntries = {
    ...(existingCache?.activities || {}),
    ...newEntries,
  };

  const actualOldestSynced = findOldestDate(allEntries);

  return {
    lastSync,
    oldestSynced: actualOldestSynced || oldest,
    activities: allEntries,
  };
}

/**
 * Sort activities by date (newest first) for coherent partial syncs
 */
export function sortActivitiesByDateDesc(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) => new Date(b.start_date_local).getTime() - new Date(a.start_date_local).getTime()
  );
}

/** Bounds type: [[minLat, minLng], [maxLat, maxLng]] */
export type BoundsType = [[number, number], [number, number]];

/**
 * Calculate the overlap ratio between two bounding boxes (array format).
 * Returns a value between 0 and 1, where 1 means complete overlap.
 */
function calculateArrayBoundsOverlap(bounds1: BoundsType, bounds2: BoundsType): number {
  const [[minLat1, minLng1], [maxLat1, maxLng1]] = bounds1;
  const [[minLat2, minLng2], [maxLat2, maxLng2]] = bounds2;

  // Calculate intersection
  const intersectMinLat = Math.max(minLat1, minLat2);
  const intersectMaxLat = Math.min(maxLat1, maxLat2);
  const intersectMinLng = Math.max(minLng1, minLng2);
  const intersectMaxLng = Math.min(maxLng1, maxLng2);

  // No overlap
  if (intersectMinLat >= intersectMaxLat || intersectMinLng >= intersectMaxLng) {
    return 0;
  }

  // Calculate areas
  const intersectionArea = (intersectMaxLat - intersectMinLat) * (intersectMaxLng - intersectMinLng);
  const area1 = (maxLat1 - minLat1) * (maxLng1 - minLng1);
  const area2 = (maxLat2 - minLat2) * (maxLng2 - minLng2);

  // Return overlap as ratio of intersection to smaller box
  const smallerArea = Math.min(area1, area2);
  if (smallerArea === 0) return 0;

  return intersectionArea / smallerArea;
}

/**
 * Check if two activities could be route matches based on their bounds.
 * Uses activity type, bounds overlap (>30%) and distance similarity (within 50%).
 */
export function couldBeRouteMatch(
  activity1: ActivityBoundsItem,
  activity2: ActivityBoundsItem,
  boundsOverlapThreshold = 0.3,
  distanceToleranceRatio = 0.5
): boolean {
  // Must be same activity type (don't compare rides with runs)
  if (activity1.type !== activity2.type) return false;

  // Skip if either has no bounds
  if (!activity1.bounds || !activity2.bounds) return false;

  // Check bounds overlap
  const overlap = calculateArrayBoundsOverlap(activity1.bounds, activity2.bounds);
  if (overlap < boundsOverlapThreshold) return false;

  // Check distance similarity (within tolerance)
  const dist1 = activity1.distance;
  const dist2 = activity2.distance;
  if (dist1 === 0 || dist2 === 0) return true; // Can't compare, assume possible match

  const distanceRatio = Math.min(dist1, dist2) / Math.max(dist1, dist2);
  return distanceRatio >= (1 - distanceToleranceRatio);
}

/**
 * Find unprocessed activity IDs that have at least one potential route match.
 * Compares unprocessed activities against ALL cached activities (including processed).
 * Only returns activities that overlap with at least one other activity.
 *
 * @param unprocessedIds - Set of activity IDs that need processing
 * @param allBounds - All cached activity bounds (processed + unprocessed)
 * @returns Set of unprocessed activity IDs that could have route matches
 */
export function findActivitiesWithPotentialMatches(
  unprocessedIds: Set<string>,
  allBounds: ActivityBoundsItem[]
): Set<string> {
  const candidateIds = new Set<string>();

  // Build a map for quick lookup
  const boundsMap = new Map<string, ActivityBoundsItem>();
  for (const b of allBounds) {
    boundsMap.set(b.id, b);
  }

  console.log(`[PreFilter] Checking ${unprocessedIds.size} unprocessed against ${allBounds.length} total bounds`);

  let checkedCount = 0;
  let matchedCount = 0;

  // For each unprocessed activity, check if it overlaps with any OTHER activity
  for (const id of unprocessedIds) {
    const activity1 = boundsMap.get(id);
    if (!activity1) {
      console.log(`[PreFilter] Activity ${id} has no cached bounds, skipping`);
      continue;
    }

    checkedCount++;
    let foundMatch = false;

    // Check against ALL other activities (both processed and unprocessed)
    for (const activity2 of allBounds) {
      if (activity1.id === activity2.id) continue;

      if (couldBeRouteMatch(activity1, activity2)) {
        candidateIds.add(activity1.id);
        foundMatch = true;
        matchedCount++;
        break; // Found a match, no need to check more
      }
    }

    if (!foundMatch && checkedCount <= 5) {
      console.log(`[PreFilter] ${activity1.name} (${activity1.type}, ${Math.round(activity1.distance/1000)}km) - no overlapping activities`);
    }
  }

  console.log(`[PreFilter] Result: ${checkedCount} checked, ${matchedCount} have potential matches`);

  return candidateIds;
}

/**
 * Optimized version using spatial index for O(n log n) instead of O(n²).
 * Falls back to brute force if spatial index is not ready.
 *
 * @param unprocessedIds - Set of activity IDs that need processing
 * @param allBounds - All cached activity bounds (processed + unprocessed)
 * @returns Set of unprocessed activity IDs that could have route matches
 */
export function findActivitiesWithPotentialMatchesFast(
  unprocessedIds: Set<string>,
  allBounds: ActivityBoundsItem[]
): Set<string> {
  // Fall back to brute force if spatial index not ready
  if (!activitySpatialIndex.ready) {
    console.log('[PreFilter] Spatial index not ready, using brute force');
    return findActivitiesWithPotentialMatches(unprocessedIds, allBounds);
  }

  const candidateIds = new Set<string>();

  // Build a map for quick lookup
  const boundsMap = new Map<string, ActivityBoundsItem>();
  for (const b of allBounds) {
    boundsMap.set(b.id, b);
  }

  console.log(`[PreFilter] Checking ${unprocessedIds.size} unprocessed using spatial index`);

  let checkedCount = 0;
  let matchedCount = 0;
  let spatialQueriesTotal = 0;

  // For each unprocessed activity, use spatial index to find overlapping activities
  for (const id of unprocessedIds) {
    const activity1 = boundsMap.get(id);
    if (!activity1) continue;

    checkedCount++;

    // Use spatial index to get candidates (O(log n) instead of O(n))
    const spatialCandidates = activitySpatialIndex.findPotentialMatches(activity1);
    spatialQueriesTotal += spatialCandidates.length;

    // Check the spatial candidates for type/distance match
    for (const candidateId of spatialCandidates) {
      const activity2 = boundsMap.get(candidateId);
      if (!activity2) continue;

      // Detailed check: type, bounds overlap ratio, distance similarity
      if (couldBeRouteMatch(activity1, activity2)) {
        candidateIds.add(activity1.id);
        matchedCount++;
        break; // Found a match, no need to check more
      }
    }
  }

  console.log(`[PreFilter] Spatial: ${checkedCount} checked, ${matchedCount} matches, avg ${(spatialQueriesTotal / checkedCount || 0).toFixed(1)} candidates/activity`);

  return candidateIds;
}
