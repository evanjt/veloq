import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionPerformances } from '@/hooks/routes/useSectionPerformances';
import { navigateTo } from '@/lib';
import { Shimmer } from '@/components/ui/Shimmer';
import { SectionInsightMap } from './SectionInsightMap';
import { SectionPerformanceTimeline } from './SectionPerformanceTimeline';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

interface SectionPRContentProps {
  insight: Insight;
  onClose: () => void;
}

export const SectionPRContent = React.memo(function SectionPRContent({
  insight,
  onClose,
}: SectionPRContentProps) {
  const { isDark } = useTheme();
  const sectionId = insight.supportingData?.sections?.[0]?.sectionId ?? null;
  const { section } = useSectionDetail(sectionId);
  const { records, bestRecord, isLoading } = useSectionPerformances(section);

  const handleSectionPress = useCallback(() => {
    onClose();
    if (sectionId) {
      navigateTo(`/section/${sectionId}`);
    }
  }, [onClose, sectionId]);

  const prData = insight.supportingData?.sections?.[0];
  const bestTimeFormatted = bestRecord
    ? formatDuration(bestRecord.bestTime)
    : prData?.bestTime
      ? formatDuration(prData.bestTime)
      : null;
  const effortCount = records.length > 0 ? records.length : undefined;
  const prDate = bestRecord?.activityDate
    ? new Date(bestRecord.activityDate).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : undefined;

  return (
    <View style={styles.container}>
      {/* Section map */}
      {section?.polyline && section.polyline.length >= 2 ? (
        <SectionInsightMap polyline={section.polyline} lineColor="#FC4C02" />
      ) : null}

      {/* PR stat */}
      {bestTimeFormatted ? (
        <View style={[styles.statCard, isDark && styles.statCardDark]}>
          <View style={styles.statRow}>
            <View style={styles.prBadge}>
              <MaterialCommunityIcons name="trophy" size={14} color="#FFFFFF" />
              <Text style={styles.prBadgeText}>PR</Text>
            </View>
            <Text style={[styles.statValue, isDark && styles.statValueDark]}>
              {bestTimeFormatted}
            </Text>
          </View>
          {prDate || effortCount ? (
            <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
              {prDate ? `Set ${prDate}` : ''}
              {prDate && effortCount ? ' · ' : ''}
              {effortCount ? `${effortCount} efforts` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Performance timeline chart */}
      {isLoading ? (
        <View style={[styles.shimmerCard, isDark && styles.shimmerCardDark]}>
          <Shimmer width="100%" height={160} borderRadius={8} />
        </View>
      ) : records.length >= 2 ? (
        <SectionPerformanceTimeline records={records} bestRecord={bestRecord} lineColor="#FC4C02" />
      ) : null}

      {/* Recent efforts list */}
      {!isLoading && records.length > 0 ? (
        <RecentEffortsList records={records} bestRecord={bestRecord} onClose={onClose} />
      ) : null}

      {/* Section link */}
      {prData ? (
        <Pressable
          style={[styles.sectionLink, isDark && styles.sectionLinkDark]}
          onPress={handleSectionPress}
        >
          <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
            {prData.sectionName}
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
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FC4C02',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  prBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueDark: {
    color: darkColors.textPrimary,
  },
  statSubtext: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statSubtextDark: {
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
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
});
