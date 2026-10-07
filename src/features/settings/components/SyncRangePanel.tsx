import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TimelineSlider } from '@/features/maps';
import { useActivityBoundsCache } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { useActivityYearCounts } from '@/shared/app/useActivityYearCounts';
import { formatLocalDate } from '@/shared/format/format';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
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
  const isFetchingExtended = useSyncDateRange((s) => isExtendedFetchRunning(s.extendedFetch));
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const isAnalysingInBackground = useSyncDateRange((s) => s.isAnalysingInBackground);
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

  // A refused change leaves every input of the slider's range as it was, so the
  // handle is put back by bumping this key.
  const [resetKey, setResetKey] = useState(0);
  const putHandleBack = useCallback(() => setResetKey((k) => k + 1), []);

  const cachedEndDate = useMemo(() => new Date(), []);

  const isSyncing = isGpsSyncing || isFetchingExtended;

  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    if (apiOldestDate) {
      return { minDateForSlider: new Date(apiOldestDate), maxDateForSlider: now };
    }
    const d = new Date();
    d.setDate(d.getDate() - DEFAULT_ACTIVITY_DAYS);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start >= cachedStartDate) {
        putHandleBack();
        return;
      }
      // A refused drag has to say why. The latch comes off when the first sync
      // settles, and until then the slider springs back with nothing on screen.
      const expand = () => {
        if (syncDateRange(formatLocalDate(start), formatLocalDate(new Date())) === 'locked') {
          putHandleBack();
          Alert.alert(t('settings.rangeLockedTitle'), t('settings.rangeLockedMessage'));
        }
      };

      // An upper bound, and zero when the sync has not stored the counts yet.
      // Neither may hold the user behind a figure the app cannot produce.
      const count = activitiesInRange(yearCounts, start, cachedStartDate);
      if (count < LARGE_HISTORY_THRESHOLD) {
        expand();
        return;
      }

      Alert.alert(t('settings.largeHistoryTitle'), t('settings.largeHistoryMessage', { count }), [
        { text: t('common.cancel'), style: 'cancel', onPress: putHandleBack },
        { text: t('settings.largeHistoryConfirm'), onPress: expand },
      ]);
    },
    [syncDateRange, cachedStartDate, yearCounts, t, putHandleBack]
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
            resetKey={resetKey}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            isDark={isDark}
            fixedEnd
            expandOnly
          />
        </View>

        {/* GPS sync progress */}
        {isSyncing || isFetchingExtended || isAnalysingInBackground ? (
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
    marginBottom: spacing.xs,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: layout.borderRadiusXs,
  },
  progressText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
});
