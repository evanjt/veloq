/**
 * The one line that says what a running sync is doing.
 *
 * `completed` and `total` count the engine's steps, the endpoints
 * `perform_sync` walks, and the line over them used to read "{{completed}} of
 * {{total}} activities". So a fresh install waiting on the athlete profile
 * said "0 of 7 activities", a quantity of activities that existed nowhere:
 * none had arrived and none was implied.
 *
 * The step is the engine's to report, for the same reason the failure reason
 * is. Deriving it here from the completed count would lag by one for every
 * step that failed, and go wrong outright the first time the order moved.
 */

import type { TFunction } from 'i18next';
import { SyncStep } from 'veloqrs';
import type { SyncStatus } from 'veloqrs';

/** The line each step names. Written out so the key type checks. */
const STEP_KEY = {
  [SyncStep.Athlete]: 'settings.syncStep.athlete',
  [SyncStep.SportSettings]: 'settings.syncStep.sportSettings',
  [SyncStep.Wellness]: 'settings.syncStep.wellness',
  [SyncStep.Census]: 'settings.syncStep.census',
  [SyncStep.Activities]: 'settings.syncStep.activities',
  [SyncStep.FirstActivities]: 'settings.syncStep.firstActivities',
  [SyncStep.Curves]: 'settings.syncStep.curves',
  [SyncStep.IntervalBodies]: 'settings.syncStep.intervalBodies',
  [SyncStep.RemainingActivities]: 'settings.syncStep.remainingActivities',
  [SyncStep.RecordActivities]: 'settings.syncStep.recordActivities',
  [SyncStep.Calendar]: 'settings.syncStep.calendar',
} as const satisfies Record<SyncStep, string>;

export function formatSyncProgress(status: SyncStatus | null, t: TFunction): string {
  const step = status?.step;
  const key = step === undefined ? undefined : STEP_KEY[step];
  // An engine newer than the bundle reports a step this build has no string
  // for, the case the error banner carries too. It still says a sync is on.
  if (!key) return t('settings.syncActivities') as string;

  const label = t(key) as string;
  const total = status?.total ?? 0;
  // A window sync declares one step, and "1 of 1" is noise rather than progress.
  if (total <= 1) return label;

  // A step that walks the library for minutes says how far along it is.
  const itemsTotal = status?.stepItemsTotal ?? 0;
  if (itemsTotal > 0) {
    return t('settings.syncStepItemsProgress', {
      label,
      completed: status?.completed ?? 0,
      total,
      itemsDone: status?.stepItemsDone ?? 0,
      itemsTotal,
    }) as string;
  }

  return t('settings.syncStepProgress', {
    label,
    completed: status?.completed ?? 0,
    total,
  }) as string;
}

/**
 * The same line split for a row too narrow to hold it whole: the label may
 * shrink with an ellipsis while the counts, which are digits and a slash in
 * every locale, keep their width beside it.
 */
export function formatSyncProgressParts(
  status: SyncStatus | null,
  t: TFunction
): { label: string; counts: string | null } {
  const step = status?.step;
  const key = step === undefined ? undefined : STEP_KEY[step];
  if (!key) return { label: t('settings.syncActivities') as string, counts: null };

  const label = t(key) as string;
  const total = status?.total ?? 0;
  if (total <= 1) return { label, counts: null };

  const steps = `${status?.completed ?? 0}/${total}`;
  const itemsTotal = status?.stepItemsTotal ?? 0;
  if (itemsTotal > 0) {
    return { label, counts: `${steps} · ${status?.stepItemsDone ?? 0}/${itemsTotal}` };
  }
  return { label, counts: steps };
}
