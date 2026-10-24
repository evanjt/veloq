/**
 * Banner for a connected but degraded network.
 *
 * The offline banner covers a dead radio. This one covers the case that is both
 * more common and more confusing: the device is connected, the sync keeps
 * failing, and every screen just looks empty. It names the engine's error and
 * the last time data actually arrived, so missing activities read as a sync
 * problem rather than an empty account.
 *
 * The engine's classified reason picks a translated line, never its English
 * message. The message stays as the fallback for a reason a shipped build has
 * no string for, which is what an engine newer than the bundle produces.
 *
 * Every fault offers a next step. A login the engine cannot use offers to
 * sign in again. A full device is the one reason the athlete can fix from
 * here, so it carries an action to the screen where space is freed. Any other
 * failure offers a retry, which asks the engine for a sync and leaves the
 * running of it to the engine: a defect that clears after an update or on its
 * own then clears without the athlete doing more.
 *
 * The banner can be closed. Closing hides it for the failure it was closed on:
 * the same reason with no sync completing since. A different reason, or a sync
 * that completes and then fails again, shows it again, so closing never hides
 * a new fault.
 *
 * A run that ended on a refusal from intervals.icu carries the time the
 * engine asks again. That is a pause the engine resumes on its own, not a
 * fault, and asks nothing of the athlete, so the paused-sync pill reports it
 * and this banner draws nothing.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SyncErrorReason } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import { navigateTo } from '@/shared/app/navigation';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { formatDateTime } from '@/shared/format';
import { SYNC_ERROR_REASON_KEY } from '@/shared/format/syncErrorReason';
import { NoticeBanner, type NoticeAction } from './NoticeBanner';

/** The reasons only a new login can clear. */
const NEEDS_LOGIN: ReadonlySet<SyncErrorReason> = new Set([
  SyncErrorReason.Unauthorized,
  SyncErrorReason.NotConfigured,
]);

function retry() {
  requestSyncRefresh();
}

export function SyncErrorBanner() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { offlineBannerShown } = useNetwork();
  const { lastError, lastErrorReason, lastSuccessAt, retryAtMs } = useSyncHealth();
  const [closedOn, setClosedOn] = useState<string | null>(null);

  // The offline pill already owns the no-connection case, and a sync cannot
  // progress offline, so this one gives way when the pill shows and not before:
  // an offline reading still inside the pill's hold leaves it up. A
  // logged-out user has no sync to report on, and the engine keeps the error
  // from the session that just ended. Demo data needs no account sync.
  const reasonKey = lastErrorReason === null ? undefined : SYNC_ERROR_REASON_KEY[lastErrorReason];

  if (
    !isAuthenticated ||
    isDemoMode ||
    offlineBannerShown ||
    (retryAtMs ?? null) !== null ||
    (!lastError && !reasonKey)
  ) {
    return null;
  }

  // What a close applies to: the reason, or the engine's message when it gave
  // none, and the last clean sync, which moves when a sync completes.
  const failure = `${lastErrorReason ?? lastError}|${lastSuccessAt}`;
  if (closedOn === failure) return null;

  const actions: NoticeAction[] = [];
  if (lastErrorReason === SyncErrorReason.StorageFull) {
    actions.push({
      label: t('common.freeUpSpace'),
      onPress: () => navigateTo('/cache-settings'),
      testID: 'sync-error-free-space',
    });
  }
  if (lastErrorReason !== null && NEEDS_LOGIN.has(lastErrorReason)) {
    actions.push({
      label: t('feed.emptyLibrary.signInAgain'),
      onPress: () => navigateTo('/login'),
      testID: 'sync-error-sign-in',
    });
  } else if (lastErrorReason !== SyncErrorReason.StorageFull) {
    actions.push({ label: t('common.retry'), onPress: retry, testID: 'sync-error-banner-retry' });
  }

  return (
    <NoticeBanner
      slot="syncError"
      tone="error"
      icon="cloud-alert"
      title={t('emptyState.syncError.title')}
      detail={[
        reasonKey ? t(reasonKey) : (lastError ?? ''),
        lastSuccessAt
          ? t('emptyState.syncError.lastSynced', { when: formatDateTime(lastSuccessAt) })
          : t('emptyState.syncError.neverSynced'),
      ]}
      actions={actions}
      onDismiss={() => setClosedOn(failure)}
      testID="sync-error-banner"
    />
  );
}
