import type { TFunction } from 'i18next';
import type { LibraryCoverage, TrackStage } from 'veloqrs';

import { formatTrackStage } from '@/features/maps';

/** What the range panel's progress row draws. */
export interface RangeProgress {
  done: number;
  total: number;
  label: string;
  /** The tracks line beside a stage label, or the stage's own count. */
  detail: string | null;
}

/**
 * The progress row under the range slider.
 *
 * The bar is the window's tracks held of tracks owed whenever any are owed,
 * and the stage only names what is running. A stage's own percent is its own
 * batch: detection on the first hundred tracks of a widened range reached 98%
 * with five hundred still to come, which read as the range being nearly done.
 * The row stays while tracks are owed with nothing running, a budget hold or
 * a lost connection, because the range is still owed then.
 */
export function rangeProgress(
  stage: TrackStage | null,
  coverage: LibraryCoverage | null,
  fetchingActivities: boolean,
  t: TFunction
): RangeProgress | null {
  const owed =
    coverage !== null &&
    coverage.tracksUpstream > 0 &&
    coverage.tracksStored < coverage.tracksUpstream;
  const stageLine = stage ? formatTrackStage(stage, t) : null;
  if (!owed && !stageLine && !fetchingActivities) return null;

  const label = stageLine?.text ?? (fetchingActivities ? t('cache.fetchingActivities') : null);
  if (owed) {
    const tracks = t('sync.tracksDownloaded', {
      completed: coverage.tracksStored,
      total: coverage.tracksUpstream,
    }) as string;
    return {
      done: coverage.tracksStored,
      total: coverage.tracksUpstream,
      label: label ?? tracks,
      detail: label === null ? null : tracks,
    };
  }
  return {
    done: stageLine?.percent ?? 0,
    total: 100,
    label: label as string,
    detail: stageLine?.countText ?? null,
  };
}
