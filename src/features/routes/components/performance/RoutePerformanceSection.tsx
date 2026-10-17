/**
 * Route progression for the activity-detail Route tab.
 * Shows a tappable header (route name + best time) and a full-width scatter
 * chart of the route's history with this activity highlighted.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Card, pressable, pressRipple } from '@/shared/ui';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tapTo } from '@/shared/app/navigation';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { getActivityColor, getActivityInk } from '@/shared/activity/activityUtils';
import { formatDuration } from '@/shared/format/format';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  mapLayerColors,
  spacing,
  typography,
  stroke,
} from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionScatterChart, ScatterLegend } from '@/features/routes/components/section';
import { formatRouteStanding } from '@/features/routes/lib/routeStanding';
import { forwardDirectionColour } from '@/features/routes/lib/directionColour';
import { ErrorState } from '@/shared/ui/ErrorState';
import { NameText } from '@/shared/ui/NameText';

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
  /** Seconds this activity's route record beat the previous best by, from the engine's route highlight. */
  improvementSeconds?: number | null;
}

export function RoutePerformanceSection({
  activityId,
  activityType,
  improvementSeconds = null,
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
    retry,
  } = useRoutePerformances(activityId);

  const activityColor = getActivityColor(activityType);
  const activityInk = getActivityInk(activityType, isDark);
  const forwardColour = forwardDirectionColour(isDark);
  const [trendDisplay, setTrendDisplay] = useState({ visible: false, reverse: false });
  const onTrendChange = useCallback((visible: boolean, direction: 'forward' | 'reverse') => {
    setTrendDisplay((current) =>
      current.visible === visible && current.reverse === (direction === 'reverse')
        ? current
        : { visible, reverse: direction === 'reverse' }
    );
  }, []);

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
    return { currentRank, attemptCount, percentileRank, gapToBestSeconds, improvementSeconds };
  }, [
    performances,
    activityId,
    currentDirectionBest,
    currentRank,
    attemptCount,
    percentileRank,
    improvementSeconds,
  ]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      tapTo(`/route/${routeGroup.id}?activityId=${encodeURIComponent(activityId)}`);
    }
  }, [routeGroup, activityId]);

  if (error !== undefined) {
    return (
      <ErrorState
        variant="inline"
        error={error}
        onRetry={retry}
        testID="route-performance-failure"
      />
    );
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
    <View style={styles.frame}>
      <Card variant="flat" padding="none">
        <Pressable
          onPress={handleRoutePress}
          accessibilityRole="button"
          accessibilityLabel={routeGroup.name}
          style={pressable(styles.header)}
          android_ripple={pressRipple}
        >
          <View style={[styles.iconBadge, { borderColor: activityInk }]}>
            <MaterialCommunityIcons name="map-marker-path" size={iconSize.xs} color={activityInk} />
          </View>
          <View style={styles.headerInfo}>
            <NameText style={[styles.routeName, isDark && styles.textLight]}>
              {routeGroup.name}
            </NameText>
            <View style={styles.metaRow}>
              <Text style={[styles.meta, isDark && styles.textSecondary]}>
                {t('maps.activitiesCount', { count: routeGroup.activityCount })}
              </Text>
              {bestTimeDisplay ? (
                <>
                  <Text style={[styles.meta, isDark && styles.textSecondary]}> · </Text>
                  <Text style={[styles.timeValue, isDark && styles.textLight]}>
                    {bestTimeDisplay}
                  </Text>
                  {isCurrentBest ? (
                    <MaterialCommunityIcons
                      name="trophy"
                      size={iconSize.xs}
                      color={colors.chartGold}
                      style={{ marginLeft: spacing.xxs }}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
          <MaterialCommunityIcons
            name="chevron-right"
            size={iconSize.md}
            color={isDark ? darkColors.iconFaint : colors.iconFaint}
          />
        </Pressable>

        <View style={styles.lineKey}>
          <View style={styles.lineKeyItem}>
            <View
              testID="route-key-activity"
              style={[styles.swatch, { backgroundColor: activityColor }]}
            />
            <Text style={[styles.meta, isDark && styles.textSecondary]}>
              {t('activityDetail.lineKeyActivity')}
            </Text>
          </View>
          <View style={styles.lineKeyItem}>
            <View
              testID="route-key-route"
              style={[styles.swatch, { backgroundColor: mapLayerColors.routeOverlay }]}
            />
            <Text style={[styles.meta, isDark && styles.textSecondary]}>
              {t('activityDetail.lineKeyRoute')}
            </Text>
          </View>
        </View>

        {standingText ? (
          <Text testID="route-standing" style={[styles.standing, isDark && styles.textSecondary]}>
            {standingText}
          </Text>
        ) : null}

        {chartData.length >= 1 && (
          <View style={styles.chartWrap}>
            <SectionScatterChart
              chartData={chartData}
              trendCurves={trendCurves}
              onTrendChange={onTrendChange}
              activityType={activityType}
              isDark={isDark}
              forwardColour={forwardColour}
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
              showTrend={trendDisplay.visible}
              trendColor={trendDisplay.reverse ? colors.reverseDirection : forwardColour}
              showReverse={!!bestReverseRecord}
              showThisActivity
              showOutsideBand={chartData.some((d) => d.outsideDistanceBand === true)}
            />
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
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
    borderWidth: stroke.one,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  headerInfo: {
    flex: 1,
  },
  routeName: {
    ...typography.bodyBold,
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
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
