/**
 * Stats row shown above/below the section scatter chart.
 *
 * Displays the direction arrow, a localized "forward" / "reverse" label,
 * a traversal count badge, the average time/pace, and the direction's PR
 * (best) time/pace with a trophy icon.
 *
 * Extracted from SectionScatterChart so the scatter component owns only
 * the chart surface itself.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { formatPace, formatDuration } from '@/lib';
import { colors, darkColors } from '@/theme';
import type { DirectionBestRecord, DirectionSummaryStats } from '@/components/routes/performance';

export interface StatsRowProps {
  direction: 'forward' | 'reverse';
  stats: DirectionSummaryStats | null;
  bestRecord: DirectionBestRecord | null;
  pointCount: number;
  /** Direction accent color (orange for forward, reverseDirection for reverse). */
  color: string;
  /** When true, show pace instead of duration for the avg/best values. */
  showPace: boolean;
  /** Section distance in meters — used to convert `avgTime` into pace when `showPace` is true. */
  sectionDistance: number;
  isDark: boolean;
}

export function StatsRow({
  direction,
  stats,
  bestRecord,
  pointCount,
  color,
  showPace,
  sectionDistance,
  isDark,
}: StatsRowProps) {
  const { t } = useTranslation();
  if (pointCount === 0) return null;

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
        <View style={[styles.countBadge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.countText, { color }]}>{pointCount}</Text>
        </View>
      </View>
      <View style={styles.statsMiddle}>
        {stats?.avgTime != null && (
          <Text style={[styles.statsValue, isDark && styles.textMuted]}>
            {showPace && sectionDistance > 0
              ? `${formatPace(sectionDistance / stats.avgTime)} ${t('sections.avg')}`
              : `${formatDuration(stats.avgTime)} ${t('sections.avg')}`}
          </Text>
        )}
      </View>
      {bestRecord && (
        <View style={styles.prBadge}>
          <MaterialCommunityIcons name="trophy" size={11} color={colors.chartGold} />
          <Text style={styles.prTime}>
            {showPace
              ? bestRecord.bestPace
                ? formatPace(bestRecord.bestPace)
                : formatDuration(bestRecord.bestTime)
              : formatDuration(bestRecord.bestTime)}
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
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statsDirection: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 2,
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statsMiddle: {
    flex: 1,
    alignItems: 'center',
  },
  statsValue: {
    fontSize: 11,
    color: colors.textMuted,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  prTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chartGold,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
