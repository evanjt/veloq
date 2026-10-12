/**
 * The line that says some routes did not download.
 *
 * `SyncErrorBanner` covers the engine's own sync and `OfflineBanner` a dead
 * radio. Neither covers this: the tracks are fetched outside the sync service,
 * so a run that gives up on three of them leaves sync health clean and every
 * banner silent while those routes are missing from the map and matched against
 * no section. It is dismissible because the fetch retries itself on the next
 * refresh, and it comes back if the next run fails on an activity it was not closed for.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';
import { tapTo } from '@/shared/app/navigation';
import { NoticeBanner } from './NoticeBanner';

export function TrackFetchNotice() {
  const { t } = useTranslation();
  const failedIds = useTrackFetchNotice((s) => s.failedIds);
  const failedCount = useTrackFetchNotice((s) => s.failedCount);
  const dismissed = useTrackFetchNotice((s) => s.dismissed);
  const dismiss = useTrackFetchNotice((s) => s.dismiss);

  if (failedCount === 0 || dismissed) return null;

  return (
    <NoticeBanner
      slot="trackFetch"
      tone="warning"
      icon="map-marker-alert"
      title={t('emptyState.tracksMissing.title', { count: failedCount })}
      detail={[t('emptyState.tracksMissing.detail')]}
      actions={
        failedIds.length === 1
          ? [
              {
                label: t('activitySummary.openActivity'),
                onPress: () => tapTo(`/activity/${failedIds[0]}`),
                testID: 'track-fetch-notice-open',
              },
            ]
          : []
      }
      onDismiss={dismiss}
      testID="track-fetch-notice"
    />
  );
}
