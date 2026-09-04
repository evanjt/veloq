/**
 * The one-line standing for an activity on its route: where it ranks, how far
 * off the best it is, and at five or more attempts what share it beat.
 * Every number comes from the engine, nothing is re-derived here.
 */

import type { TFunction } from 'i18next';
import { formatDurationDelta } from '@/shared/format/format';

/** Attempts on the route with a percentile worth showing. */
const PERCENTILE_MIN_ATTEMPTS = 5;

export interface RouteStanding {
  /** Rank of the current activity, 1 = fastest. `null` when it is not on the route. */
  currentRank: number | null;
  /** Attempts with a moving time. */
  attemptCount: number;
  /** Share of those attempts slower than the current one, 0 to 100. */
  percentileRank: number | null;
  /** Seconds between the current activity and the route best. */
  gapToBestSeconds: number | null;
}

/**
 * Format the standing sentence, or `null` when there is nothing honest to say:
 * the activity is not on the route, it is the only attempt, or the gap and the
 * rank do not describe the same population.
 */
export function formatRouteStanding(standing: RouteStanding, t: TFunction): string | null {
  const { currentRank, attemptCount, percentileRank, gapToBestSeconds } = standing;
  if (currentRank === null || attemptCount < 2 || currentRank > attemptCount) {
    return null;
  }
  if (currentRank === 1) {
    return t('routes.standingBest', { total: attemptCount }) as string;
  }
  if (gapToBestSeconds === null) {
    return null;
  }
  const gap = formatDurationDelta(gapToBestSeconds);
  if (attemptCount >= PERCENTILE_MIN_ATTEMPTS && percentileRank !== null) {
    return t('routes.standingRankPercentile', {
      rank: currentRank,
      total: attemptCount,
      gap,
      percent: Math.round(percentileRank),
    }) as string;
  }
  return t('routes.standingRank', { rank: currentRank, total: attemptCount, gap }) as string;
}
