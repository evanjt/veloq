import type { Activity, ActivityBoundsItem, ActivityBoundsCache, ActivityType } from '@/types';

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
