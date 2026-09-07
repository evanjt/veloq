import React, { useCallback, useMemo } from 'react';
import { Alert, View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TimelineSlider } from '@/features/maps/components';
import { useActivityBoundsCache } from '@/features/activity/hooks';
import { useTheme } from '@/shared/app';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { useActivityYearCounts } from '@/shared/app/useActivityYearCounts';
import { formatLocalDate } from '@/shared/format/format';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { activitiesInRange, LARGE_HISTORY_THRESHOLD } from '../lib/historyGate';
import { settingsStyles } from './settingsStyles';
import { brand, colors, colorWithOpacity, darkColors, spacing, typography, layout } from '@/theme';

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // --- Data range state ---
  const { cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();
  const { data: yearCounts } = useActivityYearCounts();

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

  const isSyncing = isGpsSyncing || isFetchingExtended;

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
      if (start >= cachedStartDate) return;
      const expand = () => syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));

      // An upper bound, and zero when the sync has not stored the counts yet.
      // Neither may hold the user behind a figure the app cannot produce.
      const count = activitiesInRange(yearCounts, start, cachedStartDate);
      if (count < LARGE_HISTORY_THRESHOLD) {
        expand();
        return;
      }

      Alert.alert(t('settings.largeHistoryTitle'), t('settings.largeHistoryMessage', { count }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.largeHistoryConfirm'), onPress: expand },
      ]);
    },
    [syncDateRange, cachedStartDate, yearCounts, t]
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.localDataRange').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Timeline slider */}
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

        {/* GPS sync progress */}
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
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sliderWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colorWithOpacity(brand.tealLight, 0.06),
  },
  progressRowDark: {
    backgroundColor: colorWithOpacity(brand.tealLight, 0.1),
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: layout.borderRadiusFull,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: spacing.xxs,
  },
  progressText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  spinner: {
    width: 22,
    height: 22,
  },
  resultText: {
    fontSize: typography.caption.fontSize,
    color: colors.primary,
  },
  resultTextDark: {
    color: colors.primary,
  },
});
