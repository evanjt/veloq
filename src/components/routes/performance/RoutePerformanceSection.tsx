/**
 * Route progression for the activity-detail Route tab.
 * Shows a tappable header (route name + best time) and a full-width scatter
 * chart of the route's history with this activity highlighted.
 */

import React, { useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { navigateTo } from '@/lib';
import { useTranslation } from 'react-i18next';
import { useRoutePerformances } from '@/hooks';
import { getActivityColor, formatDuration } from '@/lib';
import { brand, colors, darkColors, spacing, layout, typography } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionScatterChart } from '@/components/section';

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
    forwardStats,
    reverseStats,
    currentRank,
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
    }));
  }, [performances]);

  const handleRoutePress = useCallback(() => {
    if (routeGroup) {
      navigateTo(`/route/${routeGroup.id}`);
    }
  }, [routeGroup]);

  if (!routeGroup || isLoading) {
    return null;
  }

  const bestTimeDisplay =
    best && Number.isFinite(best.duration) && best.duration > 0
      ? formatDuration(best.duration)
      : null;
  const isCurrentBest = !!best && currentRank === 1;

  return (
    <View style={[styles.card, isDark && styles.cardDark]}>
      <Pressable
        onPress={handleRoutePress}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
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
              {routeGroup.activityCount} {t('routes.activities')}
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
                    style={{ marginLeft: 2 }}
                  />
                )}
              </>
            )}
          </View>
        </View>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? '#71717A' : '#CCC'}
        />
      </Pressable>

      {chartData.length >= 1 && (
        <View style={styles.chartWrap}>
          <SectionScatterChart
            chartData={chartData}
            activityType={activityType}
            isDark={isDark}
            useTimeAxis
            bestForwardRecord={bestForwardRecord}
            bestReverseRecord={bestReverseRecord}
            forwardStats={forwardStats}
            reverseStats={reverseStats}
            highlightedActivityId={activityId}
          />
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { borderColor: brand.gold, borderWidth: 2 }]} />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>
                {t('sections.legendPr')}
              </Text>
            </View>
            {bestReverseRecord ? (
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: colors.reverseDirection }]} />
                <Text style={[styles.legendText, isDark && styles.textMuted]}>
                  {t('sections.legendReverse')}
                </Text>
              </View>
            ) : null}
            <View style={styles.legendItem}>
              <View
                style={[styles.legendSwatch, { borderColor: colors.chartGreen, borderWidth: 2 }]}
              />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>
                {t('sections.legendThisActivity')}
              </Text>
            </View>
          </View>
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
    borderRadius: 11,
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
    marginBottom: 2,
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
  chartWrap: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
