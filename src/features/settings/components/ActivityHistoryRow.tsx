import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityBoundsCache } from '@/features/activity';
import { openHistoryRange } from '@/shared/app/historyRange';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

import { activityHistorySummary } from '../lib/historySummary';
import { ActivitySyncRow } from './ActivitySyncRow';
import { SettingsNavRow } from './SettingsNavRow';

/**
 * The Settings entry for the activity history: the window held and its activity count, opening
 * the history sheet, with the running sync's row beneath it.
 */
export function ActivityHistoryRow() {
  const { t } = useTranslation();
  const oldest = useSyncDateRange((s) => s.oldest);
  const { cacheStats } = useActivityBoundsCache();
  const subtitle = useMemo(
    () => activityHistorySummary(oldest, new Date(), cacheStats.totalActivities, t),
    [oldest, cacheStats.totalActivities, t]
  );

  return (
    <>
      <SettingsNavRow
        icon="history"
        title={t('settings.activityHistory')}
        subtitle={subtitle}
        onPress={openHistoryRange}
        testID="settings-nav-sync"
      />
      <ActivitySyncRow />
    </>
  );
}
