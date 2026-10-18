import { formatDistance, formatDuration, formatElevation } from '@/shared/format/format';
import type { FeedCard } from '@/types';

export interface CardPrimaryStats {
  /** Null when the activity covered no distance, so the slot is left out. */
  distance: string | null;
  duration: string;
  /** Null when the activity carries no climb, so the slot is left out. */
  elevation: string | null;
}

/** What the primary stats are drawn from, in the feed card's terms. */
export type PrimaryStatsInput = Pick<
  FeedCard,
  'distance' | 'movingTime' | 'elevationGain' | 'hasAltitude'
>;

/**
 * The distance, time and climb an activity card and the detail hero print.
 * A zero distance is no distance. A zero climb is a measurement only when the
 * activity has an altitude stream: a flat ride climbed 0 m, a trainer ride or
 * a pool swim has no climb to print.
 */
export function cardPrimaryStats(stats: PrimaryStatsInput, isMetric: boolean): CardPrimaryStats {
  const { distance, elevationGain: gain, hasAltitude } = stats;
  return {
    distance:
      distance != null && Number.isFinite(distance) && distance > 0
        ? formatDistance(distance, isMetric)
        : null,
    duration: formatDuration(stats.movingTime ?? NaN),
    elevation:
      gain != null && Number.isFinite(gain) && (gain > 0 || hasAltitude)
        ? formatElevation(gain, isMetric)
        : null,
  };
}
