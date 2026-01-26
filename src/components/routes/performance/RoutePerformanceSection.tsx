/**
 * Route performance section for activity detail view.
 * Shows route match info and performance chart over time.
 * Uses UnifiedPerformanceChart for consistent styling with route page.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useActivities } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/hooks';
import { getActivityColor } from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { UnifiedPerformanceChart, type ChartSummaryStats } from './UnifiedPerformanceChart';

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

  // Fetch activities to pass to useRoutePerformances for building performance data
  // Need a long time range to capture all activities in the route group
  const { data: activities = [] } = useActivities({ days: 365 * 3 });

  const {
    routeGroup,
    performances,
    isLoading,
    best,
    bestForwardRecord,
    bestReverseRecord,
    currentRank,
  } = useRoutePerformances(activityId, undefined, activities);

  const activityColor = getActivityColor(activityType);

  // Get match percentage for current activity
  const currentPerformance = performances.find((p) => p.isCurrent);
  const currentMatch = currentPerformance?.matchPercentage;

  // Convert performances to chart data format expected by UnifiedPerformanceChart
  const { chartData, minSpeed, maxSpeed, bestIndex, currentIndex, hasReverseRuns } = useMemo(() => {
    if (performances.length === 0) {
      return {
        chartData: [],
        minSpeed: 0,
        maxSpeed: 1,
        bestIndex: 0,
        currentIndex: -1,
        hasReverseRuns: false,
      };
    }

    // Filter out invalid speed values and convert to chart format
    const validPerformances = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed) && p.speed > 0
    );

    const dataPoints: (PerformanceDataPoint & { x: number })[] = validPerformances.map(
      (perf, idx) => ({
        x: idx,
        id: perf.activityId,
        activityId: perf.activityId,
        speed: perf.speed,
        date: perf.date,
        activityName: perf.name,
        direction: perf.direction as 'same' | 'reverse',
        matchPercentage: perf.matchPercentage,
        lapNumber: 1,
        totalLaps: validPerformances.length,
      })
    );

    const speeds = dataPoints.map((d) => d.speed);
    const min = speeds.length > 0 ? Math.min(...speeds) : 0;
    const max = speeds.length > 0 ? Math.max(...speeds) : 1;
    // Use 25% padding to ensure highlighted dots (r=10) aren't clipped at edges
    const padding = (max - min) * 0.25 || 0.5;

    // Find best (fastest) index
    let bestIdx = 0;
    if (best) {
      bestIdx = dataPoints.findIndex((d) => d.activityId === best.activityId);
      if (bestIdx === -1) bestIdx = 0;
    } else {
      for (let i = 1; i < dataPoints.length; i++) {
        if (dataPoints[i].speed > dataPoints[bestIdx].speed) {
          bestIdx = i;
        }
      }
    }

    // Find current activity index
    const currIdx = dataPoints.findIndex((d) => d.activityId === activityId);

    const hasAnyReverse = dataPoints.some((d) => d.direction === 'reverse');

    return {
      chartData: dataPoints,
      minSpeed: Math.max(0, min - padding),
      maxSpeed: max + padding,
      bestIndex: bestIdx,
      currentIndex: currIdx,
      hasReverseRuns: hasAnyReverse,
    };
  }, [performances, best, activityId]);

  // Build summary stats for the chart header
  const summaryStats = useMemo((): ChartSummaryStats => {
    if (performances.length === 0) {
      return {
        bestTime: null,
        avgTime: null,
        totalActivities: 0,
        lastActivity: null,
        currentTime: null,
        bestDate: null,
      };
    }

    const validDurations = performances.map((p) => p.duration).filter((d) => Number.isFinite(d));
    const avgDuration =
      validDurations.length > 0
        ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length
        : null;
    const dates = performances.map((p) => p.date.getTime());
    const lastActivityDate = new Date(Math.max(...dates));
    const bestTime = best?.duration;
    const bestDate = best?.date;
    const currentTime = currentPerformance?.duration;

    return {
      bestTime: bestTime !== undefined && Number.isFinite(bestTime) ? bestTime : null,
      avgTime: avgDuration,
      totalActivities: performances.length,
      lastActivity: lastActivityDate,
      currentTime: currentTime !== undefined && Number.isFinite(currentTime) ? currentTime : null,
      bestDate: bestDate ?? null,
    };
  }, [performances, best, currentPerformance]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      router.push(`/route/${routeGroup.id}` as Href);
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
          <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#555' : '#CCC'} />
        </View>
      </TouchableOpacity>

      {/* Performance Chart - only show with 2+ data points */}
      {showChart ? (
        <UnifiedPerformanceChart
          chartData={chartData}
          activityType={activityType}
          isDark={isDark}
          minSpeed={minSpeed}
          maxSpeed={maxSpeed}
          bestIndex={bestIndex}
          hasReverseRuns={hasReverseRuns}
          tooltipBadgeType="match"
          summaryStats={summaryStats}
          currentIndex={currentIndex}
          variant="activity"
          embedded
          bestForwardRecord={bestForwardRecord}
          bestReverseRecord={bestReverseRecord}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
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
