/**
 * The line that says some routes did not download.
 *
 * `SyncErrorBanner` covers the engine's own sync and `OfflinePill` a dead
 * radio. Neither covers this: the tracks are fetched outside the sync service,
 * so a run that gives up on three of them leaves sync health clean and every
 * banner silent while those routes are missing from the map and matched against
 * no section. It is dismissible because the fetch retries itself on the next
 * refresh, and it comes back if the next run fails on an activity it was not closed for.
 *
 * It is a notice about the map, so it floats as a pill in the bottom stack
 * rather than taking the top slot and pushing every screen down.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { navigateTo } from '@/shared/app/navigation';
import { FloatingPill } from './FloatingPill';

export function TrackFetchNotice() {
  const { t } = useTranslation();
  const failedIds = useTrackFetchNotice((s) => s.failedIds);
  const failedCount = useTrackFetchNotice((s) => s.failedCount);
  const dismissed = useTrackFetchNotice((s) => s.dismissed);
  const dismiss = useTrackFetchNotice((s) => s.dismiss);

  if (failedCount === 0 || dismissed) return null;

  const title = t('emptyState.tracksMissing.title', { count: failedCount });
  const detail = t('emptyState.tracksMissing.detail');
  return (
    <FloatingPill
      icon="map-marker-alert"
      title={title}
      detail={detail}
      announcement={`${title}. ${detail}`}
      action={
        failedIds.length === 1
          ? {
              label: t('activitySummary.openActivity'),
              onPress: () => navigateTo(`/activity/${failedIds[0]}`),
              testID: 'track-fetch-notice-open',
            }
          : undefined
      }
      onDismiss={dismiss}
      testID="track-fetch-notice"
    />
  );
}
