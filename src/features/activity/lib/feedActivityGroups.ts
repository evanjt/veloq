/**
 * The feed's sport chips.
 *
 * Three buckets name the types they claim and Other is everything else, rather
 * than a fourth list. A list leaves any type nobody wrote down unreachable by
 * every chip, which on a real ten-year library was 66 activities of 1,590,
 * open-water swims the largest group of them under a Swimming chip that listed
 * pool swims alone.
 */

export const FEED_GROUPS = ['Cycling', 'Running', 'Swimming', 'Other'] as const;

export type FeedGroup = (typeof FEED_GROUPS)[number];

const CLAIMED: Record<Exclude<FeedGroup, 'Other'>, readonly string[]> = {
  Cycling: ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'],
  Running: ['Run', 'VirtualRun', 'TrailRun'],
  Swimming: ['Swim', 'OpenWaterSwim'],
};

/** The one chip an activity answers to. Never null: Other takes the rest. */
export function feedGroupFor(activityType: string): FeedGroup {
  for (const group of ['Cycling', 'Running', 'Swimming'] as const) {
    if (CLAIMED[group].includes(activityType)) return group;
  }
  return 'Other';
}

export function matchesFeedGroup(group: FeedGroup, activityType: string): boolean {
  return feedGroupFor(activityType) === group;
}
