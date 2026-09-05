import type { ActivityType } from '@/types';
import { SPORT_FAMILIES } from '@/shared/native/sportTaxonomy.generated';

export type SportCategory = 'cycling' | 'running' | 'walking';

const RUNNING: readonly string[] = SPORT_FAMILIES.running;
const WALKING: readonly string[] = SPORT_FAMILIES.walking;

/**
 * The family the teleport guard reads, from the engine's taxonomy. A sport
 * the taxonomy does not name takes the cycling ceiling, the most generous,
 * because a guard that is too strict drops real points.
 */
export function getSportCategory(activityType: ActivityType): SportCategory {
  if (RUNNING.includes(activityType)) return 'running';
  if (WALKING.includes(activityType)) return 'walking';
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
