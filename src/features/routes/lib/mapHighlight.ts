import type { RoutePoint } from '@/types';

/**
 * What a detail map draws for a chart scrub: one attempt, the lap's own trace
 * if it has one, and the attempt's date, which the map key names it by.
 */
export interface MapHighlight {
  activityId: string | null;
  lapPoints: RoutePoint[] | undefined;
  date: Date | undefined;
}
