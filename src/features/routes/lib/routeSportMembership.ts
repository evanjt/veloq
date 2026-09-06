/**
 * Whether a route group was ridden, run or walked in a given sport.
 *
 * Ground is neutral: a loop covered on foot and by bike is one route, and the
 * group's scalar `sportType` is only the label of whichever activity happens to
 * represent it. Membership therefore reads the whole set of sports its
 * activities carry, the way the engine's own `summary_covers_sport` does for a
 * section. Filtering on the scalar drops a loop from every sport but one.
 */

import { toActivityType, type ActivityType } from '@/types';

interface SportBearing {
  /** The representative activity's sport, the group's display label. */
  sportType: string;
  /** Every sport that has traversed this ground, when the engine supplied it. */
  sportTypes?: string[];
}

export function groupCoversType(group: SportBearing, type: ActivityType): boolean {
  const sports = group.sportTypes?.length ? group.sportTypes : [group.sportType];
  return sports.some((sport) => toActivityType(sport) === type);
}
