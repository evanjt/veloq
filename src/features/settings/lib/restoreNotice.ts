/**
 * What a restore that went through says. It reports a finished change and asks nothing, so it is
 * a notice rather than an alert; a refused restore stays an alert.
 */

import { router } from 'expo-router';
import type { TFunction } from 'i18next';

import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';

/** What the latest restore gave up on, every pass so far included, as the engine counts it. */
export interface RestoreDrops {
  /** History rows left in the backup file because no section here covers their ground. */
  notRestored: number;
  /** Route names whose routes the grouping here merged into one already named. */
  namesNotRestored: number;
}

/** What a restore that went through reports, as the engine answers it. */
export interface RestoreReport extends RestoreDrops {
  /**
   * The file left out the export privacy home, as a copy for shared storage
   * does, so the home is unset and has to be set again.
   */
  exportHomeLeftOut: boolean;
}

/** `held`: the backup waits for the sign-in that lets it land. Otherwise it is in, with its drops. */
export type RestoreOutcome = 'held' | RestoreReport;

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
  if (outcome === 'held') {
    showNotice({ message: t('backup.heldUntilSignIn'), duration: NOTICE_LONG_MS });
    return;
  }
  const lines = [t('backup.recordRestored'), ...restoreDropLines(outcome, t)];
  if (!outcome.exportHomeLeftOut) {
    showNotice({ message: lines.join('\n'), duration: NOTICE_LONG_MS });
    return;
  }
  showNotice({
    message: [...lines, t('backup.exportHomeLeftOut')].join('\n'),
    // The export privacy row sits on the backup screen.
    action: {
      label: t('backup.setExportHome'),
      onPress: () => router.navigate('/backup-settings'),
    },
    duration: NOTICE_LONG_MS,
  });
}
