/**
 * Route progression for the activity-detail Route tab.
 * Shows a tappable header (route name + best time) and a full-width scatter
 * chart of the route's history with this activity highlighted.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { pressable, pressRipple } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo } from '@/shared/app/navigation';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { formatDuration } from '@/shared/format/format';
import { colors, darkColors, mapLayerColors, spacing, layout, typography } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionScatterChart, ScatterLegend } from '@/features/routes/components/section';
import { formatRouteStanding } from '@/features/routes/lib/routeStanding';
import { EngineReadFailure } from '@/shared/ui/EngineReadFailure';

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
    bestForwardRecord,
    bestReverseRecord,
    bestForwardIsRecord,
    bestReverseIsRecord,
    currentDirectionBest,
    forwardStats,
    reverseStats,
    currentRank,
    attemptCount,
    percentileRank,
    trendCurves,
    error,
  } = useRoutePerformances(activityId);

  const activityColor = getActivityColor(activityType);

  const chartData = useMemo((): (PerformanceDataPoint & { x: number })[] => {
    const valid = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed) && p.speed > 0
    );
    return valid.map((perf, idx) => ({
      x: idx,
      id: perf.activityId,
      activityId: perf.activityId,
      speed: perf.speed,
      date: perf.date,
      activityName: perf.name,
      direction: perf.direction as 'same' | 'reverse',
      matchPercentage: perf.matchPercentage,
      sectionTime: Math.round(perf.duration),
      outsideDistanceBand: perf.outsideDistanceBand,
    }));
  }, [performances]);

  // The gap uses the engine's best for this attempt's direction.
  const standing = useMemo(() => {
    const current = performances.find((p) => p.activityId === activityId);
    const gapToBestSeconds =
      current && currentDirectionBest && currentDirectionBest.bestTime > 0
        ? current.movingTime - currentDirectionBest.bestTime
        : null;
    return { currentRank, attemptCount, percentileRank, gapToBestSeconds };
  }, [performances, activityId, currentDirectionBest, currentRank, attemptCount, percentileRank]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      navigateTo(`/route/${routeGroup.id}`);
    }
  }, [routeGroup]);

  if (error !== undefined) {
    return <EngineReadFailure error={error} testID="route-performance-failure" />;
  }

  if (!routeGroup) {
    return null;
  }

  const bestTimeDisplay =
    currentDirectionBest &&
    Number.isFinite(currentDirectionBest.bestTime) &&
    currentDirectionBest.bestTime > 0
      ? formatDuration(currentDirectionBest.bestTime)
      : null;
  const isCurrentBest = !!currentDirectionBest && currentRank === 1;
  const standingText = formatRouteStanding(standing, t);

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <Pressable
        onPress={handleRoutePress}
        style={pressable(styles.header)}
        android_ripple={pressRipple}
      >
        <View style={[styles.iconBadge, { borderColor: activityColor }]}>
          <MaterialCommunityIcons name="map-marker-path" size={12} color={activityColor} />
        </View>
        <View style={styles.headerInfo}>
          <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
            {routeGroup.name}
          </Text>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, isDark && styles.textMuted]}>
              {t('maps.activitiesCount', { count: routeGroup.activityCount })}
            </Text>
            {bestTimeDisplay && (
              <>
                <Text style={[styles.meta, isDark && styles.textMuted]}> · </Text>
                <Text style={[styles.timeValue, isDark && styles.textLight]}>
                  {bestTimeDisplay}
                </Text>
                {isCurrentBest && (
                  <MaterialCommunityIcons
                    name="trophy"
                    size={11}
                    color={colors.chartGold}
                    style={{ marginLeft: spacing.xxs }}
                  />
                )}
              </>
            )}
          </View>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.iconFaint : colors.iconFaint}
        />
      </Pressable>

      <View style={styles.lineKey}>
        <View style={styles.lineKeyItem}>
          <View
            testID="route-key-activity"
            style={[styles.swatch, { backgroundColor: activityColor }]}
          />
          <Text style={[styles.meta, isDark && styles.textMuted]}>
            {t('activityDetail.lineKeyActivity')}
          </Text>
        </View>
        <View style={styles.lineKeyItem}>
          <View
            testID="route-key-route"
            style={[styles.swatch, { backgroundColor: mapLayerColors.routeOverlay }]}
          />
          <Text style={[styles.meta, isDark && styles.textMuted]}>
            {t('activityDetail.lineKeyRoute')}
          </Text>
        </View>
      </View>

      {standingText && (
        <Text testID="route-standing" style={[styles.standing, isDark && styles.textMuted]}>
          {standingText}
        </Text>
      )}

      {chartData.length >= 1 && (
        <View style={styles.chartWrap}>
          <SectionScatterChart
            chartData={chartData}
            trendCurves={trendCurves}
            activityType={activityType}
            isDark={isDark}
            useTimeAxis
            bestForwardRecord={bestForwardRecord}
            bestReverseRecord={bestReverseRecord}
            bestForwardIsRecord={bestForwardIsRecord}
            bestReverseIsRecord={bestReverseIsRecord}
            forwardStats={forwardStats}
            reverseStats={reverseStats}
            highlightedActivityId={activityId}
          />
          <ScatterLegend
            isDark={isDark}
            showReverse={!!bestReverseRecord}
            showThisActivity
            showOutsideBand={chartData.some((d) => d.outsideDistanceBand === true)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: layout.borderRadiusFull,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  routeName: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xxs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  meta: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  timeValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  lineKey: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  lineKeyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: spacing.md,
    height: spacing.xs,
    borderRadius: layout.borderRadiusFull,
  },
  standing: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chartWrap: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
