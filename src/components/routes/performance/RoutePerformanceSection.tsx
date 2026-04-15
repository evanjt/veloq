/**
 * Route performance section for activity detail view.
 * Shows route match info and performance scatter chart over time.
 * Uses SectionScatterChart for consistent styling with section detail page.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo } from '@/lib';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/hooks';
import { getActivityColor } from '@/lib';
import { colors, darkColors, spacing, layout, typography, shadows } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionScatterChart } from '@/components/section/SectionScatterChart';
import type { DirectionBestRecord, DirectionSummaryStats } from './UnifiedPerformanceChart';

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
}

export function RoutePerformanceSection({
  activityId,
  activityType,
}: RoutePerformanceSectionProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const {
    routeGroup,
    performances,
    isLoading,
    best,
    bestForwardRecord,
    bestReverseRecord,
    currentRank,
  } = useRoutePerformances(activityId);

  const activityColor = getActivityColor(activityType);

  // Get match percentage for current activity
  const currentPerformance = performances.find((p) => p.isCurrent);
  const currentMatch = currentPerformance?.matchPercentage;

  // Convert performances to chart data format expected by SectionScatterChart
  const chartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    if (performances.length === 0) return [];

    // Filter out invalid speed values and convert to chart format
    const validPerformances = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed) && p.speed > 0
    );

    return validPerformances.map((perf, idx) => ({
      x: idx,
      id: perf.activityId,
      activityId: perf.activityId,
      speed: perf.speed,
      date: perf.date,
      activityName: perf.name,
      direction: perf.direction as 'same' | 'reverse',
      matchPercentage: perf.matchPercentage,
    }));
  }, [performances]);

  // Compute direction stats from chart data
  const { forwardStats, reverseStats } = useMemo((): {
    forwardStats: DirectionSummaryStats | null;
    reverseStats: DirectionSummaryStats | null;
  } => {
    const fwd = chartData.filter((d) => d.direction !== 'reverse');
    const rev = chartData.filter((d) => d.direction === 'reverse');
    const buildStats = (pts: typeof chartData): DirectionSummaryStats | null => {
      if (pts.length === 0) return null;
      const durations = performances
        .filter(
          (p) => pts.some((pt) => pt.activityId === p.activityId) && Number.isFinite(p.duration)
        )
        .map((p) => p.duration);
      const avgTime =
        durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      const lastDate = new Date(Math.max(...pts.map((p) => p.date.getTime())));
      return { avgTime, lastActivity: lastDate, count: pts.length };
    };
    return { forwardStats: buildStats(fwd), reverseStats: buildStats(rev) };
  }, [chartData, performances]);

  // Map route best records to the format expected by SectionScatterChart
  const scatterBestForward = useMemo((): DirectionBestRecord | null => {
    if (!bestForwardRecord) return null;
    return {
      bestTime: bestForwardRecord.bestTime,
      activityDate: bestForwardRecord.activityDate,
    };
  }, [bestForwardRecord]);

  const scatterBestReverse = useMemo((): DirectionBestRecord | null => {
    if (!bestReverseRecord) return null;
    return {
      bestTime: bestReverseRecord.bestTime,
      activityDate: bestReverseRecord.activityDate,
    };
  }, [bestReverseRecord]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      navigateTo(`/route/${routeGroup.id}`);
    }
  }, [routeGroup]);

  // Don't show if no route match or still loading
  if (!routeGroup || isLoading) {
    return null;
  }

  const showChart = chartData.length >= 2;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Route Header - integrated into the card */}
      <TouchableOpacity style={styles.header} onPress={handleRoutePress} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: activityColor + '20' }]}>
            <MaterialCommunityIcons name="map-marker-path" size={16} color={activityColor} />
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
              {routeGroup.name}
            </Text>
            <Text style={[styles.routeMeta, isDark && styles.textMuted]}>
              {routeGroup.activityCount} {t('routes.activities')}
              {currentRank && ` · ${t('routes.fastest', { rank: currentRank })}`}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {currentMatch !== undefined && (
            <View style={[styles.matchBadge, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.matchText, { color: colors.success }]}>
                {Math.round(currentMatch)}%
              </Text>
            </View>
          )}
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? '#71717A' : '#CCC'}
          />
        </View>
      </TouchableOpacity>

      {/* Performance Chart - only show with 2+ data points */}
      {showChart ? (
        <SectionScatterChart
          chartData={chartData}
          activityType={activityType}
          isDark={isDark}
          bestForwardRecord={scatterBestForward}
          bestReverseRecord={scatterBestReverse}
          forwardStats={forwardStats}
          reverseStats={reverseStats}
        />
      ) : (
        <View style={styles.firstRunHint}>
          <Text style={[styles.firstRunText, isDark && styles.textMuted]}>
            {t('routes.firstRunHint')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingBottom: 4,
    ...shadows.card,
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeName: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routeMeta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  matchBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  matchText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  firstRunHint: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  firstRunText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
