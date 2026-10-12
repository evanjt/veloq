import type { TFunction } from 'i18next';

import { paceSeconds } from '@/shared/format/format';
import { spokenPace } from '@/shared/format/spoken';

/**
 * A completed split as a screen reader speaks it: the unit and the pace in
 * words, since "km 3 · 5:12 /km" is read out as letters and a clock time.
 * `metersPerSecond` is the split's moving speed, null when it has no moving
 * time, and a speed with no pace to print names only the distance.
 */
export function spokenSplit(
  t: TFunction,
  index: number,
  metersPerSecond: number | null,
  isMetric: boolean
): string {
  if (metersPerSecond === null || paceSeconds(metersPerSecond, isMetric) === null) {
    return isMetric
      ? t('recording.splitReachedKm', { index })
      : t('recording.splitReachedMi', { index });
  }
  const pace = spokenPace(metersPerSecond, isMetric);
  return isMetric
    ? t('recording.splitAnnouncementKm', { index, pace })
    : t('recording.splitAnnouncementMi', { index, pace });
}
