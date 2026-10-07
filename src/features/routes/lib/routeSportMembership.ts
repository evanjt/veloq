/**
 * Whether a route group was ridden, run or walked in a given sport.
 *
 * Ground is neutral: a loop covered on foot and by bike is one route.
 * Membership reads every sport its activities carry.
 */

import { toActivityType, type ActivityType } from '@/types';

interface SportBearing {
  /** Every sport that has traversed this ground. */
  sportTypes?: string[] | undefined;
}

export function groupCoversType(group: SportBearing, type: ActivityType): boolean {
  return (group.sportTypes ?? []).some((sport) => toActivityType(sport) === type);
}
