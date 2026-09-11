/**
 * Whether a route group was ridden, run or walked in a given sport.
 *
 * Ground is neutral: a loop covered on foot and by bike is one route, and the
 * group's scalar `sportType` is one label for a route that has several.
 * Membership therefore reads the whole set of sports its activities carry, the
 * way the engine's own `summary_covers_sport` does for a section. Filtering on
 * the scalar drops a loop from every sport but one.
 */

import { toActivityType, type ActivityType } from '@/types';

interface SportBearing {
  /** The sport most of the group's members carry, its one display label. */
  sportType: string;
  /** Every sport that has traversed this ground, when the engine supplied it. */
  sportTypes?: string[];
}

export function groupCoversType(group: SportBearing, type: ActivityType): boolean {
  const sports = group.sportTypes?.length ? group.sportTypes : [group.sportType];
  return sports.some((sport) => toActivityType(sport) === type);
}
