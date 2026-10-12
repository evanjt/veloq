/**
 * What a restore that went through says. It reports a finished change and asks nothing, so it is
 * a notice rather than an alert; a refused restore stays an alert.
 */

import type { TFunction } from 'i18next';

import { NOTICE_LONG_MS, showNotice } from '@/shared/ui/Notice';

/** `restored`: the backup is in. `held`: it waits for the sign-in that lets it land. */
export type RestoreOutcome = 'restored' | 'held';

export function showRestoreNotice(outcome: RestoreOutcome, t: TFunction): void {
  showNotice({
    message: outcome === 'held' ? t('backup.heldUntilSignIn') : t('backup.recordRestored'),
    duration: NOTICE_LONG_MS,
  });
}
