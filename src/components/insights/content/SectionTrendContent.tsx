import React, { useCallback } from 'react';
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
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, shadows, opacity } from '@/theme';
import type { Insight, SupportingSection } from '@/types';

function getTrendIcon(trend?: number): string {
  if (trend == null) return 'minus';
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

function getTrendColor(trend?: number, isDark?: boolean): string {
  if (trend == null) return isDark ? darkColors.textSecondary : colors.textSecondary;
  if (trend > 0) return colors.success;
  if (trend < 0) return colors.warning;
  return isDark ? darkColors.textSecondary : colors.textSecondary;
}

interface SectionTrendContentProps {
  insight: Insight;
  onClose: () => void;
}

/** Map + timeline chart for the top section */
const TopSectionDetail = React.memo(function TopSectionDetail({
  sectionId,
  onClose,
}: {
  sectionId: string;
  onClose: () => void;
}) {
  const { isDark } = useTheme();
  const { section } = useSectionDetail(sectionId);
  const { records, bestRecord, isLoading } = useSectionPerformances(section);

  return (
    <View style={detailStyles.container}>
      {/* Section name */}
      {section?.name ? (
        <Text
          style={[detailStyles.topSectionName, isDark && detailStyles.topSectionNameDark]}
          numberOfLines={2}
        >
          {section.name}
        </Text>
      ) : null}

      {/* Section map */}
      {section?.polyline && section.polyline.length >= 2 ? (
        <SectionInsightMap polyline={section.polyline} lineColor={colors.success} />
      ) : null}

      {/* Performance timeline chart */}
      {isLoading ? (
        <View style={[detailStyles.shimmerCard, isDark && detailStyles.shimmerCardDark]}>
          <Shimmer width="100%" height={160} borderRadius={8} />
        </View>
      ) : records.length >= 2 ? (
        <SectionPerformanceTimeline
          records={records}
          bestRecord={bestRecord}
          lineColor={colors.success}
        />
      ) : null}

      {/* Recent efforts list */}
      {!isLoading && records.length > 0 ? (
        <RecentEffortsList records={records} bestRecord={bestRecord} onClose={onClose} />
      ) : null}
    </View>
  );
});

const detailStyles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  topSectionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  topSectionNameDark: {
    color: darkColors.textPrimary,
  },
  shimmerCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  shimmerCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});

export const SectionTrendContent = React.memo(function SectionTrendContent({
  insight,
  onClose,
}: SectionTrendContentProps) {
  const { isDark } = useTheme();
  const sections = insight.supportingData?.sections ?? [];
  const topSectionId = sections[0]?.sectionId ?? null;

  const handleSectionPress = useCallback(
    (sectionId: string) => {
      navigateTo(`/section/${sectionId}`);
      setTimeout(onClose, 100);
    },
    [onClose]
  );

  if (sections.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Top section: map + chart + recent efforts */}
      {topSectionId ? <TopSectionDetail sectionId={topSectionId} onClose={onClose} /> : null}

      {/* Section list */}
      {sections.map((section: SupportingSection) => (
        <Pressable
          key={section.sectionId}
          style={[styles.sectionCard, isDark && styles.sectionCardDark]}
          onPress={() => handleSectionPress(section.sectionId)}
        >
          <View style={styles.sectionContent}>
            <View style={styles.sectionNameRow}>
              {section.sportType ? (
                <MaterialCommunityIcons
                  name={getActivityIcon(section.sportType)}
                  size={14}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  style={styles.sportIcon}
                />
              ) : null}
              <Text
                style={[styles.sectionName, isDark && styles.sectionNameDark]}
                numberOfLines={1}
              >
                {section.sectionName}
              </Text>
            </View>
            <View style={styles.sectionMeta}>
              {section.bestTime != null ? (
                <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
                  {formatDuration(section.bestTime)}
                </Text>
              ) : null}
              {section.traversalCount != null ? (
                <Text style={[styles.traversals, isDark && styles.traversalsDark]}>
                  {section.traversalCount}x
                </Text>
              ) : null}
              <MaterialCommunityIcons
                name={getTrendIcon(section.trend) as never}
                size={16}
                color={getTrendColor(section.trend, isDark)}
              />
            </View>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
  },
  sectionNameRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginRight: spacing.sm,
  },
  sportIcon: {
    marginRight: 4,
  },
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bestTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
  traversals: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  traversalsDark: {
    color: darkColors.textSecondary,
  },
});
