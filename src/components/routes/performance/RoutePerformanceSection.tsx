/**
 * Route performance section for activity detail view.
 * Shows route match info and performance chart over time.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme, useActivities } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/hooks';
import {
  formatSpeed,
  formatPace,
  isRunningActivity,
  getActivityColor,
  formatShortDate as formatShortDateLib,
} from '@/lib';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { ActivityType } from '@/types';
import type { RoutePerformancePoint } from '@/hooks/routes/useRoutePerformances';
import { StatsRow } from './StatsRow';
import { ChartLegend } from './ChartLegend';
import { PerformanceChart } from './PerformanceChart';

interface RoutePerformanceSectionProps {
  activityId: string;
  activityType: ActivityType;
}

function formatShortDate(date: Date): string {
  return formatShortDateLib(date);
}

function getDirectionIcon(direction: string) {
  switch (direction) {
    case 'reverse':
      return 'swap-horizontal' as const;
    case 'partial':
      return 'arrow-split-vertical' as const;
    default:
      return 'arrow-right' as const;
  }
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

  const { routeGroup, performances, isLoading, best, currentRank } = useRoutePerformances(
    activityId,
    undefined,
    activities
  );

  // Tooltip state - persists after scrubbing ends so user can tap
  const [tooltipData, setTooltipData] = useState<RoutePerformancePoint | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isPersisted, setIsPersisted] = useState(false);

  // Check if we have any reverse runs for legend
  const hasReverseRuns = useMemo(() => {
    return performances.some((p) => p.direction === 'reverse');
  }, [performances]);

  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Cyan/teal stands out from gold (best), green (match badges), and activity colors
  const currentActivityColor = '#00BCD4';

  // Format speed/pace for display
  const formatSpeedValue = useCallback(
    (speed: number) => {
      if (showPace) {
        return formatPace(speed);
      }
      return formatSpeed(speed);
    },
    [showPace]
  );

  // Handle tooltip updates from chart
  const handleTooltipUpdate = useCallback(
    (point: RoutePerformancePoint | null, persisted: boolean) => {
      if (point === null) {
        setTooltipData(null);
        setIsActive(false);
        setIsPersisted(false);
      } else if (persisted) {
        setTooltipData(point);
        setIsActive(false);
        setIsPersisted(true);
      } else {
        setTooltipData(point);
        setIsActive(true);
        setIsPersisted(false);
      }
    },
    []
  );

  // Navigate to activity when tapping tooltip
  const handleActivityPress = useCallback(() => {
    if (tooltipData) {
      router.push(`/activity/${tooltipData.activityId}` as Href);
    }
  }, [tooltipData]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      router.push(`/route/${routeGroup.id}` as Href);
    }
  }, [routeGroup]);

  // Don't show if no route match or still loading
  if (!routeGroup || isLoading) {
    return null;
  }

  // Get current activity performance
  const currentPerformance = performances.find((p) => p.isCurrent);
  const displayPerformance = tooltipData || currentPerformance;

  // Get match percentage for current activity
  const currentMatch = currentPerformance?.matchPercentage;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      {/* Section Title with Match Badge */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitle}>
          <Text style={[styles.sectionTitleText, isDark && styles.textMuted]}>
            {t('routes.matchedRoute')}
          </Text>
          {currentMatch !== undefined && (
            <View style={[styles.matchBadge, { backgroundColor: colors.success + '20' }]}>
              <Text style={[styles.matchText, { color: colors.success }]}>
                {Math.round(currentMatch)}% {t('routes.match')}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Route Header */}
      <TouchableOpacity style={styles.header} onPress={handleRoutePress} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconBadge, { backgroundColor: activityColor + '20' }]}>
            <MaterialCommunityIcons name="map-marker-path" size={16} color={activityColor} />
          </View>
          <View>
            <Text style={[styles.routeName, isDark && styles.textLight]} numberOfLines={1}>
              {routeGroup.name}
            </Text>
            <Text style={[styles.routeMeta, isDark && styles.textMuted]}>
              {routeGroup.activityCount} {t('routes.activities')}
              {currentRank && ` · ${t('routes.fastest', { rank: currentRank })}`}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={20} color={isDark ? '#555' : '#CCC'} />
      </TouchableOpacity>

      {/* Selected activity info - OUTSIDE gesture area so it's tappable */}
      {(isActive || isPersisted) && tooltipData && (
        <TouchableOpacity
          style={[styles.selectedActivity, isDark && styles.selectedActivityDark]}
          onPress={handleActivityPress}
          activeOpacity={0.7}
        >
          <View style={styles.selectedActivityLeft}>
            <View
              style={[
                styles.selectedActivityIcon,
                { backgroundColor: currentActivityColor + '20' },
              ]}
            >
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={16}
                color={currentActivityColor}
              />
            </View>
            <View style={styles.selectedActivityInfo}>
              <Text
                style={[styles.selectedActivityName, isDark && styles.textLight]}
                numberOfLines={1}
              >
                {tooltipData.name}
              </Text>
              <View style={styles.selectedActivityMeta}>
                <Text style={[styles.selectedActivityDate, isDark && styles.textMuted]}>
                  {formatShortDate(tooltipData.date)}
                </Text>
                <View
                  style={[styles.selectedMatchBadge, { backgroundColor: colors.success + '20' }]}
                >
                  <Text style={[styles.selectedMatchText, { color: colors.success }]}>
                    {Math.round(tooltipData.matchPercentage)}%
                  </Text>
                </View>
                {tooltipData.direction !== 'same' && (
                  <View
                    style={[
                      styles.directionBadge,
                      tooltipData.direction === 'reverse' && styles.directionReverse,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={getDirectionIcon(tooltipData.direction)}
                      size={10}
                      color={tooltipData.direction === 'reverse' ? '#EC4899' : '#F59E0B'}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
          <View style={styles.selectedActivityRight}>
            <Text style={[styles.selectedActivitySpeed, { color: currentActivityColor }]}>
              {formatSpeedValue(tooltipData.speed)}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={isDark ? '#555' : '#CCC'}
            />
          </View>
        </TouchableOpacity>
      )}

      {/* Performance Chart */}
      <PerformanceChart
        performances={performances}
        bestActivityId={best?.activityId}
        isDark={isDark}
        formatSpeedValue={formatSpeedValue}
        currentActivityColor={currentActivityColor}
        onTooltipUpdate={handleTooltipUpdate}
      />

      {/* Stats Row */}
      <StatsRow
        currentSpeed={displayPerformance?.speed ?? null}
        bestSpeed={best?.speed ?? null}
        bestDate={best?.date ?? null}
        formatSpeedValue={formatSpeedValue}
        showPace={showPace}
        isTooltipActive={(isActive || isPersisted) && tooltipData !== null}
        isDark={isDark}
        currentActivityColor={currentActivityColor}
      />

      {/* Legend */}
      <ChartLegend
        currentActivityColor={currentActivityColor}
        hasReverseRuns={hasReverseRuns}
        isDark={isDark}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleText: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textSecondary,
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  selectedActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 188, 212, 0.08)',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 188, 212, 0.2)',
  },
  selectedActivityDark: {
    backgroundColor: 'rgba(0, 188, 212, 0.12)',
    borderColor: 'rgba(0, 188, 212, 0.3)',
  },
  selectedActivityLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  selectedActivityIcon: {
    width: 32,
    height: 32,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedActivityInfo: {
    flex: 1,
  },
  selectedActivityName: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  selectedActivityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  selectedActivityDate: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  selectedMatchBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
  },
  selectedMatchText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
  },
  selectedActivityRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  selectedActivitySpeed: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 152, 0, 0.15)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: spacing.xs,
    gap: 2,
  },
  directionReverse: {
    backgroundColor: 'rgba(233, 30, 99, 0.15)',
  },
});
