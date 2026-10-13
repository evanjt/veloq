import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useSectionPerformances } from '@/features/routes';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { cardSportType } from '@/features/insights/lib/cardSport';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { Shimmer } from '@/shared/ui/Shimmer';
import { ErrorState } from '@/shared/ui/ErrorState';
import { SectionInsightMap } from './SectionInsightMap';
import { SectionPerformanceTimeline } from './SectionPerformanceTimeline';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration, formatShortDate } from '@/shared/format/format';
import { colors, darkColors, spacing, opacity, brand, layout, typography } from '@/theme';
import { prRecordOf } from '@/features/insights/lib/directionBests';
import type { Insight } from '@/types';

interface SectionPRContentProps {
  insight: Insight;
}

export const SectionPRContent = React.memo(function SectionPRContent({
  insight,
}: SectionPRContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const prData = insight.supportingData?.sections?.[0];
  const sectionId = prData?.sectionId ?? null;
  const { section, error: sectionError, retry: retrySection } = useSectionDetail(sectionId);
  // The timeline and effort list show the sport the record was set in.
  const {
    records,
    bests,
    isLoading,
    error: streamsError,
    refetch: refetchStreams,
  } = useSectionPerformances(section, prData?.sportType);

  // The record's sport, not the section's: shared ground holds a record in
  // each sport that travels it.
  const bestRecord = useMemo(() => prRecordOf(bests), [bests]);
  const sportType = cardSportType(prData?.sportType, section?.sportTypes);
  const bestTime = prData?.bestTime ?? bestRecord?.bestTime ?? null;
  const bestTimeFormatted = bestTime != null ? formatDuration(bestTime) : null;
  const effortCount = prData?.standingCount;
  const delta = prData?.deltaSeconds;
  const deltaFormatted = delta != null && delta > 0 ? formatDuration(delta) : null;
  const previousBestDate =
    prData?.previousBestDate != null
      ? formatShortDate(new Date(prData.previousBestDate * 1000))
      : undefined;
  const previousBestTimeFormatted =
    prData?.previousBestTime != null ? formatDuration(prData.previousBestTime) : null;
  const percentileFaster = prData?.percentileFaster;

  return (
    <View style={styles.container}>
      {sectionError !== undefined ? (
        <ErrorState
          variant="inline"
          error={sectionError}
          onRetry={retrySection}
          testID="section-read-failure"
        />
      ) : null}

      {/* Section map */}
      {section?.polyline && section.polyline.length >= 2 ? (
        <SectionInsightMap polyline={section.polyline} lineColor={brand.gold} />
      ) : null}

      {/* What the record beat; the time itself is the sheet's figure */}
      {bestTimeFormatted ? (
        <View style={[styles.statCard, isDark && styles.statCardDark]}>
          {/* Section name */}
          {prData?.sectionName ? (
            <View style={styles.sectionTitleRow}>
              {sportType ? (
                <MaterialCommunityIcons
                  name={getActivityIcon(sportType)}
                  size={14}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  style={styles.sportIcon}
                />
              ) : null}
              <Text
                style={[styles.sectionTitle, isDark && styles.sectionTitleDark]}
                numberOfLines={1}
              >
                {prData.sectionName}
              </Text>
            </View>
          ) : null}

          {/* Delta from previous best */}
          {deltaFormatted ? (
            <Text style={[styles.deltaText, isDark && styles.prTextDark]}>
              {t('insights.sectionPrSheet.fromPrevious', { delta: deltaFormatted })}
            </Text>
          ) : null}

          {/* Previous best context */}
          {previousBestTimeFormatted && previousBestDate ? (
            <Text style={[styles.previousText, isDark && styles.previousTextDark]}>
              {t('insights.sectionPrSheet.previous', {
                time: previousBestTimeFormatted,
                date: previousBestDate,
              })}
            </Text>
          ) : null}

          {/* Stats row: effort count + percentile */}
          <View style={styles.contextRow}>
            {effortCount != null && effortCount > 1 ? (
              <View style={[styles.contextChip, isDark && styles.contextChipDark]}>
                <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                  {t('insights.sectionPrSheet.efforts', { count: effortCount })}
                </Text>
              </View>
            ) : null}
            {percentileFaster != null && percentileFaster > 0 ? (
              <View style={[styles.contextChip, isDark && styles.contextChipDark]}>
                <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                  {t('insights.sectionPrSheet.fasterThan', { percent: percentileFaster })}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Performance timeline chart */}
      {streamsError ? (
        <ErrorState
          variant="inline"
          error={streamsError}
          onRetry={refetchStreams}
          testID="section-stream-failure"
        />
      ) : isLoading ? (
        <View style={[styles.shimmerCard, isDark && styles.shimmerCardDark]}>
          <Shimmer width="100%" height={160} borderRadius={8} />
        </View>
      ) : records.length >= 2 ? (
        <SectionPerformanceTimeline records={records} bests={bests} lineColor={brand.gold} />
      ) : null}

      {/* Recent efforts list */}
      {!streamsError && !isLoading && records.length > 0 ? (
        <RecentEffortsList records={records} bests={bests} />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  sectionTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: spacing.xxs,
  },
  sportIcon: {
    marginRight: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sectionTitleDark: {
    color: darkColors.textSecondary,
  },
  deltaText: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.chartGoldText,
    fontVariant: ['tabular-nums'],
  },
  prTextDark: {
    color: darkColors.chartGoldText,
  },
  previousText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  previousTextDark: {
    color: darkColors.textSecondary,
  },
  contextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  contextChip: {
    backgroundColor: opacity.overlay.light,
    borderRadius: layout.borderRadiusMd,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
  },
  contextChipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  contextText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  contextTextDark: {
    color: darkColors.textSecondary,
  },
  shimmerCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  shimmerCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
