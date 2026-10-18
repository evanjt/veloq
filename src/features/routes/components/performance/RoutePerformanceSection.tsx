/**
 * Route progression for the activity-detail Route tab.
 * Opens with the activity's standing on the route, then a tappable header
 * (route name + best time) and the performance panel over the route's
 * history, its card opening on this activity.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@/shared/app';
import { Card, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Text } from 'react-native-paper';
import { useOpenDetail } from '@/shared/app/MapSheetCards';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/features/routes/hooks/useRoutePerformances';
import { useDrawnMapStyle } from '@/features/maps';
import { useMapPreferences } from '@/features/settings';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import { formatDuration } from '@/shared/format/format';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  mapPalette,
  spacing,
  typography,
  stroke,
} from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { PerformanceChartPanel } from '@/features/routes/components/section';
import { formatRouteStanding } from '@/features/routes/lib/routeStanding';
import { ErrorState } from '@/shared/ui/ErrorState';
import { NameText } from '@/shared/ui/NameText';

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
  /** Seconds this activity's route record beat the previous best by, from the engine's route highlight. */
  improvementSeconds?: number | null;
  /** Seconds this activity was off the route best, from the same highlight the feed card reads. */
  gapToBestSeconds?: number | null;
}

export function RoutePerformanceSection({
  activityId,
  activityType,
  improvementSeconds = null,
  gapToBestSeconds = null,
}: RoutePerformanceSectionProps) {
  const { t } = useTranslation();
  const openDetail = useOpenDetail();
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

  // The key repeats the colours the activity map draws its lines in, for the
  // base that map opens on.
  const { getStyleForActivity } = useMapPreferences();
  const mapColours = mapPalette(useDrawnMapStyle(getStyleForActivity(activityType, activityId)));
  const activityColor = sportMarkColour(activityType, isDark);

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
      isBest: perf.isRecord,
    }));
  }, [performances]);

  // The exact times are the route highlight's, so the page spells out the
  // number the feed card's chip shows; the rank and percentile are the page's.
  const standing = useMemo(
    () => ({ currentRank, attemptCount, percentileRank, gapToBestSeconds, improvementSeconds }),
    [currentRank, attemptCount, percentileRank, gapToBestSeconds, improvementSeconds]
  );

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      openDetail({ kind: 'route', id: routeGroup.id, params: { activityId } });
    }
  }, [routeGroup, activityId, openDetail]);

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
      {standingText ? (
        <Text testID="route-standing" style={[styles.standing, isDark && styles.textLight]}>
          {standingText}
        </Text>
      ) : null}
      <Card variant="flat" padding="none">
        <PressTarget
          onPress={handleRoutePress}
          accessibilityRole="button"
          accessibilityLabel={routeGroup.name}
          style={styles.header}
        >
          <View style={[styles.iconBadge, { borderColor: activityColor }]}>
            <Icon name="map-marker-path" size={iconSize.xs} color={activityColor} />
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
                    <Icon
                      name="trophy"
                      size={iconSize.xs}
                      color={colors.achievement}
                      style={{ marginLeft: spacing.xxs }}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          </View>
          <Icon
            name="chevron-right"
            size={iconSize.md}
            color={isDark ? darkColors.iconMuted : colors.iconMuted}
          />
        </PressTarget>

        <View style={styles.lineKey}>
          <View style={styles.lineKeyItem}>
            <View
              testID="route-key-activity"
              style={[styles.swatch, { backgroundColor: mapColours.route }]}
            />
            <Text style={[styles.meta, isDark && styles.textSecondary]}>
              {t('activityDetail.lineKeyActivity')}
            </Text>
          </View>
          <View style={styles.lineKeyItem}>
            <View
              testID="route-key-route"
              style={[styles.swatch, { backgroundColor: mapColours.muted }]}
            />
            <Text style={[styles.meta, isDark && styles.textSecondary]}>
              {t('activityDetail.lineKeyRoute')}
            </Text>
          </View>
        </View>

        {chartData.length >= 1 && (
          <View style={styles.chartWrap}>
            <PerformanceChartPanel
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
    ...typography.badge,
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
    ...typography.body,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
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
