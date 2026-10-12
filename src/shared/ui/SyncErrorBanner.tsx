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
 * A failure that can pass on its own offers a retry, which asks the engine for
 * a sync and leaves the running of it to the engine. A refused login or a
 * missing one cannot pass that way, so it offers none.
 *
 * A full device is the one reason the athlete can fix from here, so it carries
 * an action to the screen where space is freed.
 *
 * A run that ended on a refusal from intervals.icu carries the time the
 * engine asks again. That is a pause the engine resumes on its own, not a
 * fault, so the banner turns neutral, names the time and offers no retry.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SyncErrorReason } from 'veloqrs';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import { tapTo } from '@/shared/app/navigation';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { formatDateTime } from '@/shared/format';
import { formatClockOrDate } from '@/shared/format/format';
import { SYNC_ERROR_REASON_KEY } from '@/shared/format/syncErrorReason';
import { NoticeBanner, type NoticeAction } from './NoticeBanner';

/** The reasons a later sync can get past without the athlete changing anything. */
const RETRYABLE: ReadonlySet<SyncErrorReason> = new Set([
  SyncErrorReason.Network,
  SyncErrorReason.Server,
  SyncErrorReason.RateLimited,
  SyncErrorReason.Internal,
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

  // The offline pill already owns the no-connection case, and a sync cannot
  // progress offline, so this one gives way when the pill shows and not before:
  // an offline reading still inside the pill's hold leaves it up. A
  // logged-out user has no sync to report on, and the engine keeps the error
  // from the session that just ended. Demo data needs no account sync.
  const reasonKey = lastErrorReason === null ? undefined : SYNC_ERROR_REASON_KEY[lastErrorReason];

  if (!isAuthenticated || isDemoMode || offlineBannerShown || (!lastError && !reasonKey)) {
    return null;
  }

  const pausedUntil = retryAtMs ?? null;
  const paused = pausedUntil !== null;

  const actions: NoticeAction[] = [];
  if (lastErrorReason === SyncErrorReason.StorageFull) {
    actions.push({
      label: t('common.freeUpSpace'),
      onPress: () => tapTo('/cache-settings'),
      testID: 'sync-error-free-space',
    });
  }
  if (!paused && lastErrorReason !== null && RETRYABLE.has(lastErrorReason)) {
    actions.push({ label: t('common.retry'), onPress: retry, testID: 'sync-error-banner-retry' });
  }

  return (
    <NoticeBanner
      slot="syncError"
      tone={paused ? 'neutral' : 'error'}
      icon={paused ? 'timer-sand' : 'cloud-alert'}
      title={
        paused
          ? t('emptyState.syncError.paused', { time: formatClockOrDate(pausedUntil) })
          : t('emptyState.syncError.title')
      }
      detail={[
        paused
          ? t('emptyState.syncError.pausedDetail')
          : reasonKey
            ? t(reasonKey)
            : (lastError ?? ''),
        lastSuccessAt
          ? t('emptyState.syncError.lastSynced', { when: formatDateTime(lastSuccessAt) })
          : t('emptyState.syncError.neverSynced'),
      ]}
      actions={actions}
      testID="sync-error-banner"
    />
  );
}
