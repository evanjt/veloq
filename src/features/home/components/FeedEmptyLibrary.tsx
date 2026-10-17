/**
 * What the feed shows when the library is empty and no sync is filling it.
 *
 * A first sync that stopped short used to read "No activities found" to an
 * athlete with hundreds of rides on intervals.icu. Each cause is named here
 * with the action that fills the feed: a paused sync resumes by itself, a
 * refused login needs signing in again, and a failed sync is retried. The line
 * under a failure is the engine's classified reason, the one the sync banner
 * reads. Only a sync that settled clean over nothing says the library is
 * empty, and it says where activities come from.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { navigateTo } from '@/shared/app/navigation';
import { SYNC_ERROR_REASON_KEY } from '@/shared/format/syncErrorReason';
import { useSyncLastErrorReason } from '@/shared/native/useSyncStatus';
import { EmptyState } from '@/shared/ui/EmptyState';

import type { FeedEmptyState } from '../lib/feedEmptyState';

interface FeedEmptyLibraryProps {
  state: Extract<FeedEmptyState, 'paused' | 'authExpired' | 'failed' | 'empty'>;
  /** Start the sync again. */
  onRetry: () => void;
}

export function FeedEmptyLibrary({ state, onRetry }: FeedEmptyLibraryProps) {
  const { t } = useTranslation();
  const lastErrorReason = useSyncLastErrorReason();
  const reasonKey = lastErrorReason === null ? undefined : SYNC_ERROR_REASON_KEY[lastErrorReason];

  switch (state) {
    case 'paused':
      return (
        <EmptyState
          icon="pause-circle-outline"
          title={t('feed.emptyLibrary.pausedTitle')}
          description={reasonKey ? t(reasonKey) : t('feed.emptyLibrary.pausedBody')}
        />
      );
    case 'authExpired':
      return (
        <EmptyState
          icon="account-alert-outline"
          title={t('feed.emptyLibrary.authExpiredTitle')}
          description={t('emptyState.syncError.reason.unauthorized')}
          actionLabel={t('feed.emptyLibrary.signInAgain')}
          onAction={() => navigateTo('/login')}
        />
      );
    case 'failed':
      return (
        <EmptyState
          icon="cloud-alert"
          title={t('feed.emptyLibrary.failedTitle')}
          description={reasonKey ? t(reasonKey) : t('feed.emptyLibrary.failedBody')}
          actionLabel={t('common.retry')}
          onAction={onRetry}
        />
      );
    case 'empty':
      return (
        <EmptyState
          icon="inbox-outline"
          title={t('feed.emptyLibrary.emptyTitle')}
          description={t('feed.emptyLibrary.emptyBody')}
          actionLabel={t('feed.emptyLibrary.record')}
          onAction={() => navigateTo('/record')}
        />
      );
  }
}
