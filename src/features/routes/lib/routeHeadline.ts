import type { RouteDetailData } from 'veloqrs';

export interface RouteHeadline {
  distance: number;
  lastDate: string;
}

/**
 * The route's own distance and newest attempt, as the engine read them. Both
 * describe the route across every sport, so the sport chip does not move them.
 */
export function routeHeadline(
  detail: Pick<RouteDetailData, 'distanceMeters' | 'lastActivityDate'> | null | undefined
): RouteHeadline {
  if (!detail) return { distance: 0, lastDate: '' };
  const seconds = detail.lastActivityDate;
  const date = seconds == null ? null : new Date(seconds * 1000);
  return {
    distance: detail.distanceMeters,
    lastDate: date && Number.isFinite(date.getTime()) ? date.toISOString() : '',
  };
}
