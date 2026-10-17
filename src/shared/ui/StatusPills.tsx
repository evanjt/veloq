/**
 * The status pills with nothing to count: the device being offline, and a sync
 * the engine has paused and will resume on its own.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useNetwork } from '@/shared/app/NetworkContext';
import { formatClockOrDate } from '@/shared/format/format';
import { useSyncHealth } from '@/shared/native/useSyncHealth';
import { FloatingPill } from './FloatingPill';

/**
 * Shows once the provider says so, which trails the offline reading by a
 * delay, and hides on the render the device comes back.
 */
export function OfflinePill() {
  const { t } = useTranslation();
  const { offlineBannerShown } = useNetwork();

  if (!offlineBannerShown) return null;

  const title = t('emptyState.offline.title');
  const detail = t('emptyState.offline.description');
  return (
    <FloatingPill
      icon="cloud-off-outline"
      title={title}
      detail={detail}
      announcement={`${title}. ${detail}`}
      testID="offline-pill"
    />
  );
}

/**
 * The time the engine asks again, while a run that ended on a refusal from
 * intervals.icu waits for it. It asks nothing of the athlete, so it is a pill
 * and not a banner. It gives way to the offline pill, since no sync runs
 * offline, and draws nothing signed out or in demo mode, where there is no
 * account sync.
 */
export function usePausedSyncUntil(): number | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { offlineBannerShown } = useNetwork();
  const { retryAtMs } = useSyncHealth();

  if (!isAuthenticated || isDemoMode || offlineBannerShown) return null;
  return retryAtMs ?? null;
}

export function PausedSyncPill() {
  const { t } = useTranslation();
  const pausedUntil = usePausedSyncUntil();

  if (pausedUntil === null) return null;

  const title = t('emptyState.syncError.paused', { time: formatClockOrDate(pausedUntil) });
  const detail = t('emptyState.syncError.pausedDetail');
  return (
    <FloatingPill
      icon="timer-sand"
      title={title}
      detail={detail}
      announcement={`${title}. ${detail}`}
      testID="paused-sync-pill"
    />
  );
}
