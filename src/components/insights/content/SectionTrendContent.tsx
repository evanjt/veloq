import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionPerformances } from '@/hooks/routes/useSectionPerformances';
import { navigateTo } from '@/lib';
import { MiniPerformanceSparkline } from './MiniPerformanceSparkline';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, opacity, shadows } from '@/theme';
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

/** Top section chart — only for the first section in the list */
const TopSectionChart = React.memo(function TopSectionChart({ sectionId }: { sectionId: string }) {
  const { section } = useSectionDetail(sectionId);
  const { records, bestRecord, isLoading } = useSectionPerformances(section);

  if (isLoading || records.length < 2) return null;

  const chartData = records.map((r) => ({
    date: r.activityDate,
    time: r.bestTime,
  }));
  const bestIndex = bestRecord
    ? records.findIndex((r) => r.activityId === bestRecord.activityId)
    : undefined;

  return (
    <View style={chartStyles.card}>
      <MiniPerformanceSparkline data={chartData} bestIndex={bestIndex} color="#66BB6A" />
    </View>
  );
});

const chartStyles = StyleSheet.create({
  card: {
    marginBottom: spacing.sm,
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
      onClose();
      navigateTo(`/section/${sectionId}`);
    },
    [onClose]
  );

  if (sections.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Top section chart */}
      {topSectionId ? <TopSectionChart sectionId={topSectionId} /> : null}

      {/* Section list */}
      {sections.map((section: SupportingSection) => (
        <Pressable
          key={section.sectionId}
          style={[styles.sectionCard, isDark && styles.sectionCardDark]}
          onPress={() => handleSectionPress(section.sectionId)}
        >
          <View style={styles.sectionContent}>
            <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
              {section.sectionName}
            </Text>
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
    backgroundColor: '#FFFFFF',
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
