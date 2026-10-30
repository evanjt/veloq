import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TimelineSlider } from '@/features/maps';
import { useActivityBoundsCache } from '@/features/activity';
import { useTheme } from '@/shared/app';
import { useOldestActivityDate } from '@/shared/app/useOldestActivityDate';
import { useActivityYearCounts } from '@/features/settings/hooks/useActivityYearCounts';
import { formatClockTime, formatLocalDate } from '@/shared/format/format';
import { DEFAULT_ACTIVITY_DAYS } from '@/shared/native/activityWindow.generated';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { useTrackStage } from '@/shared/native/useSyncStatus';
import { useLibraryCoverage } from '@/shared/native/useLibraryCoverage';
import { useBackfillDayShare } from '../hooks/useBackfillDayShare';
import { activitiesInRange, historyConfirmCopy, LARGE_HISTORY_THRESHOLD } from '../lib/historyGate';
import { rangeProgress } from '../lib/rangeProgress';
import { dailyLimitLines } from '../lib/dailyLimitLines';
import { useDailyLimit } from '../hooks/useBackgroundJobs';
import { settingsStyles } from './settingsStyles';
import {
  colors,
  colorWithOpacity,
  darkColors,
  opacity,
  spacing,
  typography,
  themePalette,
} from '@/theme';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { ProgressBar } from '@/shared/ui/ProgressRow';

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { t } = useTranslation();

  // --- Data range state ---
  const { cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();
  const { data: yearCounts } = useActivityYearCounts();
  const dayShare = useBackfillDayShare();

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => isExtendedFetchRunning(s.extendedFetch));
  // The track work as the engine reports it, whoever started it, against the
  // tracks the window still owes.
  const trackStage = useTrackStage();
  const coverage = useLibraryCoverage();
  const progress = useMemo(
    () => rangeProgress(trackStage, coverage, isFetchingExtended, t),
    [trackStage, coverage, isFetchingExtended, t]
  );
  const limitLines = dailyLimitLines(useDailyLimit(), t, (epochMs) =>
    formatClockTime(new Date(epochMs).toISOString())
  );
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

  const isSyncing = trackStage !== null || isFetchingExtended;

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
          inform({
            title: t('settings.rangeLockedTitle'),
            message: t('settings.rangeLockedMessage'),
          });
        }
      };

      // An upper bound, and zero when the sync has not stored the counts yet.
      // Neither may hold the user behind a figure the app cannot produce.
      const count = activitiesInRange(yearCounts, start, cachedStartDate);
      if (count < LARGE_HISTORY_THRESHOLD) {
        expand();
        return;
      }

      const copy = historyConfirmCopy(count, dayShare);
      confirmAction({
        title:
          copy.kind === 'days'
            ? t('settings.largeHistoryDaysTitle', { count: copy.days })
            : t('settings.largeHistoryTitle'),
        message:
          copy.kind === 'days'
            ? t('settings.largeHistoryDaysMessage')
            : t('settings.largeHistoryMessage', { count: copy.count }),
        confirmLabel: t('settings.largeHistoryConfirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: expand,
        onCancel: putHandleBack,
      });
    },
    [syncDateRange, cachedStartDate, yearCounts, dayShare, t, putHandleBack]
  );

  return (
    <>
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

        {/* The range's tracks, owed or downloading */}
        {progress ? (
          <View
            style={[
              styles.progressRow,
              {
                backgroundColor: isDark
                  ? colorWithOpacity(palette.actionPrimary, opacity.tint2)
                  : colorWithOpacity(palette.actionPrimary, opacity.tint1),
              },
            ]}
          >
            <ProgressBar
              done={progress.done}
              total={progress.total}
              label={progress.label}
              fillTestID="settings-sync-range-progress-fill"
            />
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {progress.label}
              {progress.detail ? ` (${progress.detail})` : null}
            </Text>
            {limitLines ? (
              <>
                <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
                  {limitLines.shared}
                </Text>
                <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
                  {limitLines.today}
                </Text>
                <Text
                  style={[styles.resetText, isDark && styles.progressTextDark]}
                  testID="settings-sync-range-limit-reset"
                >
                  {limitLines.reset}
                </Text>
              </>
            ) : null}
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
  },
  progressText: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.textSecondary,
  },
  resetText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
});
