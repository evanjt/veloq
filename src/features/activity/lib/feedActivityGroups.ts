/**
 * The feed's sport chips.
 *
 * Which chip an activity answers to is the engine's rule, applied where the
 * search runs over the whole library: cycling, running and swimming name their
 * families and Other takes everything else, so no sport is left under no chip.
 */

import { FeedSportGroup } from 'veloqrs';

import { FEED_GROUPS, type FeedGroup } from '@/shared/activity/sportCategories';

export { FEED_GROUPS };
export type { FeedGroup };

const SPORT_GROUP: Record<FeedGroup, FeedSportGroup> = {
  Cycling: FeedSportGroup.Cycling,
  Running: FeedSportGroup.Running,
  Swimming: FeedSportGroup.Swimming,
  Other: FeedSportGroup.Other,
};

/** The engine's name for a chip. */
export function feedSportGroup(group: FeedGroup): FeedSportGroup {
  return SPORT_GROUP[group];
}
