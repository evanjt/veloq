/**
 * Route performance row for activity detail view.
 * Compact thin-row layout matching the sections tab — small icon badge,
 * route name, meta line, optional sparkline, chevron. Tap opens the
 * route detail page where the full scatter chart lives.
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
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { ActivityType, PerformanceDataPoint } from '@/types';
import { SectionSparkline } from '@/components/section/SectionSparkline';

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

  const { routeGroup, performances, isLoading, best, currentRank } =
    useRoutePerformances(activityId);

  const activityColor = getActivityColor(activityType);

  // Sparkline data — same shape SectionSparkline expects
  const sparklineData = useMemo((): (PerformanceDataPoint & { x: number })[] | undefined => {
    if (performances.length < 2) return undefined;
    const valid = performances.filter(
      (p) => p.direction !== 'partial' && Number.isFinite(p.speed) && p.speed > 0
    );
    if (valid.length < 2) return undefined;
    return valid.map((perf, idx) => ({
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
    <Pressable
      onPress={handleRoutePress}
      style={({ pressed }) => [styles.card, isDark && styles.cardDark, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.header}>
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
        {sparklineData && (
          <View>
            <SectionSparkline
              data={sparklineData}
              width={80}
              height={28}
              isDark={isDark}
              highlightActivityId={activityId}
            />
          </View>
        )}
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? '#71717A' : '#CCC'}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
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
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
