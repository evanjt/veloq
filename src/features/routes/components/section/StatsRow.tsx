/**
 * Stats row shown above/below the section scatter chart.
 *
 * Displays the direction arrow, a localized "forward" / "reverse" label,
 * a traversal count badge, the average time/pace, and the direction's best
 * time/pace. The engine says whether that best is the direction's record: a
 * record carries a trophy and the gold value, any other best (the best of a
 * range, a lone lap, a tie) reads as "Best" in the muted value style.
 *
 * Extracted from SectionScatterChart so the scatter component owns only
 * the chart surface itself.
 */

import { useMetricSystem } from '@/shared/app';
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { formatPace, formatSwimPace, formatDuration } from '@/shared/format/format';
import { colors, colorWithOpacity, darkColors, typography, layout, spacing } from '@/theme';
import type {
  DirectionBestRecord,
  DirectionSummaryStats,
} from '@/features/routes/lib/performanceTypes';

export interface StatsRowProps {
  direction: 'forward' | 'reverse';
  stats: DirectionSummaryStats | null;
  bestRecord: DirectionBestRecord | null;
  /** True when `bestRecord` is the direction's record, as the engine judges it. */
  bestIsRecord: boolean;
  pointCount: number;
  /** Direction accent color (activity color for forward, reverseDirection for reverse). */
  color: string;
  /** When true, show pace instead of duration for the avg/best values. */
  showPace: boolean;
  /** When true, format pace as min/100m instead of min/km. */
  isSwimming?: boolean;
  isDark: boolean;
}

export function StatsRow({
  direction,
  stats,
  bestRecord,
  bestIsRecord,
  pointCount,
  color,
  showPace,
  isSwimming = false,
  isDark,
}: StatsRowProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  if (pointCount === 0) return null;

  const bestValue = bestRecord
    ? showPace && bestRecord.bestPace
      ? isSwimming
        ? formatSwimPace(bestRecord.bestPace, isMetric)
        : formatPace(bestRecord.bestPace, isMetric)
      : formatDuration(bestRecord.bestTime)
    : '';

  return (
    <View style={styles.statsRow}>
      <View style={styles.statsLeft}>
        <MaterialCommunityIcons
          name={direction === 'forward' ? 'arrow-right' : 'arrow-left'}
          size={14}
          color={color}
        />
        <Text style={[styles.statsDirection, isDark && styles.textLight]}>
          {direction === 'forward' ? t('sections.forward') : t('sections.reverse')}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: colorWithOpacity(color, 0.13) }]}>
          <Text style={[styles.countText, { color }]}>{pointCount}</Text>
        </View>
      </View>
      <View style={styles.statsMiddle}>
        {stats?.avgTime != null && (
          <Text style={[styles.statsValue, isDark && styles.textMuted]}>
            {showPace && stats.avgSpeed != null && stats.avgSpeed > 0
              ? `${isSwimming ? formatSwimPace(stats.avgSpeed, isMetric) : formatPace(stats.avgSpeed, isMetric)} ${t('sections.avg')}`
              : `${formatDuration(stats.avgTime)} ${t('sections.avg')}`}
          </Text>
        )}
      </View>
      {bestRecord && (
        <View style={styles.prBadge}>
          {bestIsRecord && (
            <View testID={`stats-row-trophy-${direction}`}>
              <MaterialCommunityIcons
                name="trophy"
                size={11}
                color={isDark ? darkColors.chartGoldMark : colors.chartGoldMark}
              />
            </View>
          )}
          <Text
            testID={`stats-row-best-${direction}`}
            style={
              bestIsRecord
                ? [styles.prTime, isDark && styles.prTimeDark]
                : [styles.statsValue, isDark && styles.textMuted]
            }
          >
            {bestIsRecord ? bestValue : `${bestValue} ${t('sections.best')}`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.sm,
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statsDirection: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countBadge: {
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusSm,
    marginLeft: spacing.xxs,
  },
  countText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '700',
  },
  statsMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  statsValue: {
    fontSize: typography.label.fontSize,
    color: colors.textMuted,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  prTime: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.chartGoldText,
  },
  prTimeDark: {
    color: darkColors.chartGoldText,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
