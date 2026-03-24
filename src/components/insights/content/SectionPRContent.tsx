import React, { useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionPerformances } from '@/hooks/routes/useSectionPerformances';
import { navigateTo } from '@/lib';
import { Shimmer } from '@/components/ui/Shimmer';
import { MiniPerformanceSparkline } from './MiniPerformanceSparkline';
import { formatDurationCompact } from '@/hooks/insights/generateInsights';
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
  const bestTimeFormatted = prData?.bestTime ? formatDurationCompact(prData.bestTime) : null;
  const daysAgoPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.unit === 'days' || dp.label.toLowerCase().includes('days')
  );

  // Build chart data from performance records
  const chartData = records.map((r) => ({
    date: r.activityDate,
    time: r.bestTime,
  }));
  const bestIndex = bestRecord
    ? records.findIndex((r) => r.activityId === bestRecord.activityId)
    : undefined;

  return (
    <View style={styles.container}>
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
          {daysAgoPoint ? (
            <Text style={[styles.statSubtext, isDark && styles.statSubtextDark]}>
              {String(daysAgoPoint.value)} {daysAgoPoint.unit ?? ''} ago
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Performance chart */}
      {isLoading ? (
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          <Shimmer width="100%" height={100} borderRadius={8} />
        </View>
      ) : chartData.length >= 2 ? (
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>
            All efforts ({records.length})
          </Text>
          <MiniPerformanceSparkline data={chartData} bestIndex={bestIndex} color="#FC4C02" />
        </View>
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
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chartLabelDark: {
    color: darkColors.textSecondary,
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
