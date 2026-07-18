import type { ActivityType } from '@/types';

export type SportCategory = 'cycling' | 'running' | 'walking';

export function getSportCategory(activityType: ActivityType): SportCategory {
  const lower = activityType.toLowerCase();
  if (lower.includes('ride') || lower.includes('cycling') || lower.includes('bike'))
    return 'cycling';
  if (lower.includes('run') || lower.includes('treadmill')) return 'running';
  if (lower.includes('walk') || lower.includes('hike')) return 'walking';
  return 'cycling';
}

// Teleport guard ceilings, deliberately generous so real efforts always pass:
// cycling 126 km/h covers alpine descents, running 45 km/h, walking 29 km/h.
const MAX_PLAUSIBLE_SPEED_MS: Record<SportCategory, number> = {
  cycling: 35,
  running: 12.5,
  walking: 8,
};

/** Upper bound (m/s) used to reject GPS teleport jumps for a sport. */
export function getMaxPlausibleSpeed(activityType: ActivityType): number {
  return MAX_PLAUSIBLE_SPEED_MS[getSportCategory(activityType)];
}
