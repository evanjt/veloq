import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TimelineSlider } from '@/components/maps';
import { useActivityBoundsCache, useOldestActivityDate, useTheme } from '@/hooks';
import { formatLocalDate } from '@/lib';
import { useSyncDateRange } from '@/providers';
import { settingsStyles } from './settingsStyles';
import { colors, darkColors, spacing } from '@/theme';

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const { progress, cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);

  const cachedStartDate = useMemo(() => {
    if (isExpansionLocked) return new Date(syncOldest);
    if (cacheStats.oldestDate) {
      const cacheOldest = new Date(cacheStats.oldestDate);
      const syncStart = new Date(syncOldest);
      return cacheOldest < syncStart ? cacheOldest : syncStart;
    }
    return new Date(syncOldest);
  }, [cacheStats.oldestDate, syncOldest, isExpansionLocked]);

  const cachedEndDate = useMemo(() => new Date(), []);

  const isSyncing = progress.status === 'syncing' || isGpsSyncing || isFetchingExtended;

  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    if (apiOldestDate) {
      return { minDateForSlider: new Date(apiOldestDate), maxDateForSlider: now };
    }
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start < cachedStartDate) {
        syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));
      }
    },
    [syncDateRange, cachedStartDate]
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.localDataRange').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={styles.sliderWrap}>
          <TimelineSlider
            minDate={minDateForSlider}
            maxDate={maxDateForSlider}
            startDate={cachedStartDate}
            endDate={cachedEndDate}
            onRangeChange={handleRangeChange}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            cachedOldest={null}
            cachedNewest={null}
            isDark={isDark}
            showActivityFilter={false}
            showCachedRange={false}
            showLegend={false}
            showSyncBanner={false}
            fixedEnd
            expandOnly
          />
        </View>
        {isSyncing || isFetchingExtended ? (
          <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.max(gpsSyncProgress.percent, 2)}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {gpsSyncProgress.message ||
                (isFetchingExtended
                  ? t('cache.fetchingActivities', 'Fetching activities...')
                  : t('common.loading'))}
              {gpsSyncProgress.total > 0 &&
                ` (${gpsSyncProgress.completed}/${gpsSyncProgress.total})`}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sliderWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
  },
  progressRowDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
});
