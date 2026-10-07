import type { ActivityBoundsItem } from '@/types';

/**
 * The activities the opening camera looks for a cluster in.
 *
 * A virtual ride's track is drawn where the virtual route is, so a winter of
 * them in one simulated world outnumbers the real rides and the map opens over
 * an ocean. They are left out here and nowhere else: they stay on the map and in
 * Fit all. A library with nothing outdoor keeps every activity so the map still
 * opens somewhere.
 */
export function openingClusterActivities(activities: ActivityBoundsItem[]): ActivityBoundsItem[] {
  const outdoor = activities.filter((a) => !a.isVirtual);
  return outdoor.length > 0 ? outdoor : activities;
}
