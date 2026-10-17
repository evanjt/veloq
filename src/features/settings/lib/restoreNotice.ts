/**
 * What a restore that went through says. It reports a finished change and asks nothing, so it is
 * a notice rather than an alert; a refused restore stays an alert.
 */

import type { TFunction } from 'i18next';

import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';

/** What the latest restore gave up on, every pass so far included, as the engine counts it. */
export interface RestoreDrops {
  /** History rows left in the backup file because no section here covers their ground. */
  notRestored: number;
  /** Route names whose routes the grouping here merged into one already named. */
  namesNotRestored: number;
}

/** `held`: the backup waits for the sign-in that lets it land. Otherwise it is in, with its drops. */
export type RestoreOutcome = 'held' | RestoreDrops;

/** One line per kind of row a restore gave up on, empty when it gave up on none. */
export function restoreDropLines(drops: RestoreDrops, t: TFunction): string[] {
  const lines: string[] = [];
  if (drops.namesNotRestored > 0) {
    lines.push(t('backup.namesNotRestored', { count: drops.namesNotRestored }));
  }
  if (drops.notRestored > 0) {
    lines.push(t('backup.historyNotRestored', { count: drops.notRestored }));
  }
  return lines;
}

export function showRestoreNotice(outcome: RestoreOutcome, t: TFunction): void {
  showNotice({
    message:
      outcome === 'held'
        ? t('backup.heldUntilSignIn')
        : [t('backup.recordRestored'), ...restoreDropLines(outcome, t)].join('\n'),
    duration: NOTICE_LONG_MS,
  });
}
