import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionPerformances } from '@/hooks/routes/useSectionPerformances';
import { navigateTo } from '@/lib';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import { Shimmer } from '@/components/ui/Shimmer';
import { SectionInsightMap } from './SectionInsightMap';
import { SectionPerformanceTimeline } from './SectionPerformanceTimeline';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration, formatShortDate } from '@/lib';
import { colors, darkColors, spacing, opacity, brand } from '@/theme';
import type { Insight } from '@/types';
import type { SectionPerformanceRecord } from '@/hooks/routes/useSectionPerformances';

const ACCENT_COLOR = brand.orange;

interface SectionPRContentProps {
  insight: Insight;
}

/**
 * Compute the second-best time from all records (the "previous best" before the current PR).
 * Returns the record with the second-lowest bestTime, excluding the PR record.
 */
function findPreviousBest(
  records: SectionPerformanceRecord[],
  bestRecord: SectionPerformanceRecord | null
): SectionPerformanceRecord | null {
  if (!bestRecord || records.length < 2) return null;
  let secondBest: SectionPerformanceRecord | null = null;
  for (const r of records) {
    if (r.activityId === bestRecord.activityId) continue;
    if (!secondBest || r.bestTime < secondBest.bestTime) {
      secondBest = r;
    }
  }
  return secondBest;
}

export const SectionPRContent = React.memo(function SectionPRContent({
  insight,
}: SectionPRContentProps) {
  const { isDark } = useTheme();
  const sectionId = insight.supportingData?.sections?.[0]?.sectionId ?? null;
  const { section } = useSectionDetail(sectionId);
  const { records, bestRecord, isLoading } = useSectionPerformances(section);

  const handleSectionPress = useCallback(() => {
    if (sectionId) {
      navigateTo(`/section/${sectionId}`);
    }
  }, [sectionId]);

  const prData = insight.supportingData?.sections?.[0];
  const bestTime = bestRecord?.bestTime ?? prData?.bestTime ?? null;
  const bestTimeFormatted = bestTime != null ? formatDuration(bestTime) : null;
  const effortCount = records.length > 0 ? records.length : undefined;

  // Previous best: the second-fastest time across all efforts
  const previousBest = useMemo(() => findPreviousBest(records, bestRecord), [records, bestRecord]);
  const delta = previousBest && bestTime != null ? previousBest.bestTime - bestTime : null;
  const deltaFormatted = delta != null && delta > 0 ? formatDuration(delta) : null;
  const previousBestDate = previousBest?.activityDate
    ? formatShortDate(previousBest.activityDate)
    : undefined;
  const previousBestTimeFormatted = previousBest ? formatDuration(previousBest.bestTime) : null;

  // Percentile: what percentage of efforts this PR is faster than
  const percentileFaster = useMemo(() => {
    if (!bestRecord || records.length < 3) return null;
    const slowerCount = records.filter(
      (r) => r.activityId !== bestRecord.activityId && r.bestTime > bestRecord.bestTime
    ).length;
    const otherCount = records.length - 1;
    if (otherCount <= 0) return null;
    return Math.round((slowerCount / otherCount) * 100);
  }, [records, bestRecord]);

  // PR context: count how many recent PRs from the insight data
  const recentPRCount = insight.supportingData?.sections?.length ?? 0;

  return (
    <View style={styles.container}>
      {/* Section map */}
      {section?.polyline && section.polyline.length >= 2 ? (
        <SectionInsightMap polyline={section.polyline} lineColor={ACCENT_COLOR} />
      ) : null}

      {/* PR celebration card */}
      {bestTimeFormatted ? (
        <View style={[styles.statCard, isDark && styles.statCardDark]}>
          {/* Section name */}
          {prData?.sectionName ? (
            <View style={styles.sectionTitleRow}>
              {section?.sportType ? (
                <MaterialCommunityIcons
                  name={getActivityIcon(section.sportType)}
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

          {/* PR time with trophy */}
          <View style={styles.prRow}>
            <MaterialCommunityIcons name="trophy-outline" size={24} color={ACCENT_COLOR} />
            <Text style={styles.prTime}>{bestTimeFormatted}</Text>
          </View>

          {/* Delta from previous best */}
          {deltaFormatted ? (
            <Text style={styles.deltaText}>
              {'\u2212'}
              {deltaFormatted} from previous
            </Text>
          ) : null}

          {/* Previous best context */}
          {previousBestTimeFormatted && previousBestDate ? (
            <Text style={[styles.previousText, isDark && styles.previousTextDark]}>
              Previous: {previousBestTimeFormatted} on {previousBestDate}
            </Text>
          ) : null}

          {/* Stats row: effort count + percentile */}
          <View style={styles.contextRow}>
            {effortCount != null && effortCount > 1 ? (
              <View style={[styles.contextChip, isDark && styles.contextChipDark]}>
                <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                  {effortCount} efforts
                </Text>
              </View>
            ) : null}
            {percentileFaster != null && percentileFaster > 0 ? (
              <View style={[styles.contextChip, isDark && styles.contextChipDark]}>
                <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                  Faster than {percentileFaster}% of efforts
                </Text>
              </View>
            ) : null}
            {recentPRCount > 1 ? (
              <View style={[styles.contextChip, isDark && styles.contextChipDark]}>
                <Text style={[styles.contextText, isDark && styles.contextTextDark]}>
                  {recentPRCount} PRs this week
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Performance timeline chart */}
      {isLoading ? (
        <View style={[styles.shimmerCard, isDark && styles.shimmerCardDark]}>
          <Shimmer width="100%" height={160} borderRadius={8} />
        </View>
      ) : records.length >= 2 ? (
        <SectionPerformanceTimeline
          records={records}
          bestRecord={bestRecord}
          lineColor={ACCENT_COLOR}
        />
      ) : null}

      {/* Recent efforts list */}
      {!isLoading && records.length > 0 ? (
        <RecentEffortsList records={records} bestRecord={bestRecord} />
      ) : null}

      {/* Section link */}
      {prData ? (
        <Pressable
          style={[styles.sectionLink, isDark && styles.sectionLinkDark]}
          onPress={handleSectionPress}
        >
          <Text style={[styles.linkText, isDark && styles.linkTextDark]} numberOfLines={1}>
            View section details
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
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
    borderRadius: 10,
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
    marginBottom: 2,
  },
  sportIcon: {
    marginRight: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  sectionTitleDark: {
    color: darkColors.textSecondary,
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  prTime: {
    fontSize: 32,
    fontWeight: '700',
    color: ACCENT_COLOR,
    fontVariant: ['tabular-nums'],
  },
  deltaText: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT_COLOR,
    fontVariant: ['tabular-nums'],
  },
  previousText: {
    fontSize: 13,
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
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  contextChipDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  contextText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  contextTextDark: {
    color: darkColors.textSecondary,
  },
  shimmerCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  shimmerCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  sectionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  sectionLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  linkTextDark: {
    color: darkColors.textPrimary,
  },
});
