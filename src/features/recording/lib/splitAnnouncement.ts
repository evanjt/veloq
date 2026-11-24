import type { TFunction } from 'i18next';
import { recordings } from 'veloqrs';

import { spokenPaceSeconds } from '@/shared/format/spoken';

/**
 * A completed split as a screen reader speaks it: the unit and the pace in
 * words, since "km 3 · 5:12 /km" is read out as letters and a clock time.
 * `metersPerSecond` is the split's moving speed, null when it has no moving
 * time, and a speed the engine has no pace for names only the distance.
 */
export function spokenSplit(
  t: TFunction,
  index: number,
  metersPerSecond: number | null,
  isMetric: boolean
): string {
  const seconds =
    metersPerSecond === null
      ? undefined
      : recordings.livePace(metersPerSecond, undefined, isMetric).seconds;
  if (seconds === undefined) {
    return isMetric
      ? t('recording.splitReachedKm', { index })
      : t('recording.splitReachedMi', { index });
  }
  const pace = spokenPaceSeconds(seconds, isMetric);
  return isMetric
    ? t('recording.splitAnnouncementKm', { index, pace })
    : t('recording.splitAnnouncementMi', { index, pace });
}
