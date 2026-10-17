/**
 * The feed's sport chips, one per family.
 *
 * Which family an activity is in is the engine's rule, applied where the
 * search runs over the whole library, and Other takes every sport no family
 * lists, so no sport is left under no chip.
 */

import type { EngineSportFamily } from 'veloqrs';

import { toEngineSportFamily } from '@/shared/activity/engineSportFamily';
import {
  SPORT_FAMILY_LABELS,
  SPORT_FAMILY_ORDER,
  type SportFamily,
} from '@/shared/activity/sportCategories';

export type FeedGroup = SportFamily;

export const FEED_GROUPS: readonly FeedGroup[] = SPORT_FAMILY_ORDER;

/** Each chip's label, as a translation key. */
export const FEED_GROUP_LABELS = SPORT_FAMILY_LABELS;

/** The engine's name for a chip. */
export function feedSportGroup(group: FeedGroup): EngineSportFamily {
  return toEngineSportFamily(group);
}
