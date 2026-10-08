import type { RouteDetailData } from 'veloqrs';

export interface RouteHeadline {
  distance: number;
  /** Metres climbed over the representative activity. */
  elevationGain: number;
}

/**
 * The route's own distance and climbing, the representative activity's as the
 * engine read them. Both describe the line on the map, so neither the sport
 * chip nor the range moves them.
 */
export function routeHeadline(
  detail: Pick<RouteDetailData, 'distanceMeters' | 'elevationGainMeters'> | null | undefined
): RouteHeadline {
  if (!detail) return { distance: 0, elevationGain: 0 };
  return { distance: detail.distanceMeters, elevationGain: detail.elevationGainMeters };
}
