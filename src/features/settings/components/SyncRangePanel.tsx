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
import { activitiesInRange, historyConfirmCopy } from '../lib/historyGate';
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
import { inform } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui';
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

  // The range the slider proposes. Nothing downloads until it is confirmed.
  const [proposedStart, setProposedStart] = useState<Date | null>(null);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start >= cachedStartDate) {
        setProposedStart(null);
        putHandleBack();
        return;
      }
      setProposedStart(start);
    },
    [cachedStartDate, putHandleBack]
  );

  // An upper bound, and zero when the sync has not stored the counts yet. Neither may hold the
  // athlete behind a figure the app cannot produce.
  const cost = useMemo(() => {
    if (!proposedStart) return null;
    const count = activitiesInRange(yearCounts, proposedStart, cachedStartDate);
    return historyConfirmCopy(count, dayShare);
  }, [proposedStart, yearCounts, cachedStartDate, dayShare]);

  const confirm = useCallback(() => {
    if (!proposedStart) return;
    const outcome = syncDateRange(formatLocalDate(proposedStart), formatLocalDate(new Date()));
    setProposedStart(null);
    if (outcome === 'locked') {
      // The latch comes off when the first sync settles, and until then the slider springs back.
      putHandleBack();
      inform({
        title: t('settings.rangeLockedTitle'),
        message: t('settings.rangeLockedMessage'),
      });
    }
  }, [proposedStart, syncDateRange, putHandleBack, t]);

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

        {/* What the proposed range costs, and what it unlocks */}
        {cost ? (
          <View style={styles.costRow}>
            <Text
              testID="history-range-cost"
              style={[styles.progressText, isDark && styles.progressTextDark]}
            >
              {t('settings.historyCost', { activities: cost.count })}
            </Text>
            {cost.kind === 'days' ? (
              <Text
                testID="history-range-days"
                style={[styles.progressText, isDark && styles.progressTextDark]}
              >
                {t('settings.largeHistoryDaysTitle', { count: cost.days })}
              </Text>
            ) : null}
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {t('settings.historyUnlocks')}
            </Text>
            <Button
              testID="history-range-confirm"
              style={styles.confirm}
              label={t('settings.historyConfirm')}
              onPress={confirm}
            />
          </View>
        ) : null}

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
  costRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  confirm: {
    marginTop: spacing.sm,
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
