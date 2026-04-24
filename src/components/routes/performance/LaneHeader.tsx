/**
 * Collapsible header row for a direction lane in UnifiedPerformanceChart.
 *
 * Renders the direction arrow + label, traversal count badge, average pace
 * (or duration) text, PR badge with best time + date, and an expand/collapse
 * chevron. One `<Pressable>` wraps everything so the whole bar is a tap
 * target for toggling the lane.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { formatPace, formatDuration } from '@/lib';
import { formatShortDateWithYear } from '@/lib/charts/dateFormatting';
import { colors, darkColors } from '@/theme';
import type { DirectionBestRecord, DirectionSummaryStats } from './UnifiedPerformanceChart';

export interface LaneHeaderProps {
  direction: 'forward' | 'reverse';
  /** Translated label shown next to the direction arrow. */
  label: string;
  /** Translated "avg" suffix appended to the summary pace/duration. */
  avgLabel: string;
  /** Accent color — activity color for forward, reverseDirection for reverse. */
  color: string;
  /** Count of traversals in this lane (rendered in the count badge). */
  count: number;
  /** Whether the lane chart is currently expanded (drives chevron direction). */
  expanded: boolean;
  /** Called when the user taps anywhere on the header. */
  onToggle: () => void;
  /** Whether to format the average as pace (true) or speed/duration (false). */
  showPace: boolean;
  /** Section distance in meters — used to convert avgTime to pace when >0. */
  sectionDistance: number;
  /** Whether the surrounding screen is in dark mode. */
  isDark: boolean;
  /** Best record in this direction (null hides the PR badge). */
  bestRecord?: DirectionBestRecord | null;
  /** Summary stats in this direction (null hides the avg text). */
  stats?: DirectionSummaryStats | null;
}

export function LaneHeader({
  direction,
  label,
  avgLabel,
  color,
  count,
  expanded,
  onToggle,
  showPace,
  sectionDistance,
  isDark,
  bestRecord,
  stats,
}: LaneHeaderProps) {
  const arrowIcon = direction === 'forward' ? 'arrow-right' : 'arrow-left';

  return (
    <View style={[styles.lane, isDark && styles.laneDark]}>
      <Pressable style={[styles.laneHeader, isDark && styles.laneHeaderDark]} onPress={onToggle}>
        {/* Left: Direction + count */}
        <View style={styles.laneHeaderLeft}>
          <MaterialCommunityIcons
            name={arrowIcon}
            size={16}
            color={color}
            style={styles.directionIcon}
          />
          <Text style={[styles.laneTitle, isDark && styles.textLight]}>{label}</Text>
          <View style={[styles.countBadge, { backgroundColor: color + '20' }]}>
            <Text style={[styles.countText, { color }]}>{count}</Text>
          </View>
        </View>
        {/* Middle: Avg */}
        <View style={styles.laneHeaderMiddle}>
          {stats?.avgTime != null && (
            <Text style={[styles.headerStatText, isDark && styles.headerStatTextDark]}>
              {showPace
                ? sectionDistance > 0
                  ? `${formatPace(sectionDistance / stats.avgTime)} ${avgLabel}`
                  : stats.avgSpeed
                    ? `${formatPace(stats.avgSpeed)} ${avgLabel}`
                    : `${formatDuration(stats.avgTime)} ${avgLabel}`
                : `${formatDuration(stats.avgTime)} ${avgLabel}`}
            </Text>
          )}
        </View>
        {/* Right: PR with date below */}
        {bestRecord && (
          <View style={styles.prBadgeStacked}>
            <View style={styles.prBadgeRow}>
              <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
              <Text style={styles.prBadgeTime}>
                {showPace
                  ? bestRecord.bestPace
                    ? formatPace(bestRecord.bestPace)
                    : formatDuration(bestRecord.bestTime)
                  : formatDuration(bestRecord.bestTime)}
              </Text>
            </View>
            <Text style={styles.prBadgeDateSmall}>
              {formatShortDateWithYear(bestRecord.activityDate)}
            </Text>
          </View>
        )}
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={isDark ? darkColors.textMuted : colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  lane: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  laneDark: {
    borderTopColor: darkColors.border,
  },
  laneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  laneHeaderDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  laneHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  laneHeaderMiddle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerStatText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  headerStatTextDark: {
    color: darkColors.textMuted,
  },
  prBadgeStacked: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  prBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  prBadgeDateSmall: {
    fontSize: 9,
    color: colors.chartGold,
    opacity: 0.7,
  },
  directionIcon: {
    marginRight: 2,
  },
  laneTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
  prBadgeTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chartGold,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
});
