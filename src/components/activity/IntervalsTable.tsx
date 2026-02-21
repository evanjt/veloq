import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Text } from 'react-native';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatHeartRate,
  formatPower,
  isRunningActivity,
  isCyclingActivity,
} from '@/lib';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks';
import { colors, spacing } from '@/theme';
import type { ActivityInterval, ActivityType } from '@/types';

interface IntervalsTableProps {
  intervals: ActivityInterval[];
  activityType: ActivityType;
  isMetric: boolean;
  isDark: boolean;
}

export function IntervalsTable({ intervals, activityType, isMetric, isDark }: IntervalsTableProps) {
  const showPace = isRunningActivity(activityType);

  const isCycling = isCyclingActivity(activityType);
  const hasHR = useMemo(() => intervals.some((i) => i.average_heartrate != null), [intervals]);
  const hasPower = useMemo(() => intervals.some((i) => i.average_watts != null), [intervals]);

  const renderItem = ({ item, index }: { item: ActivityInterval; index: number }) => {
    const isWork = item.type === 'WORK';
    const isRecovery = item.type === 'RECOVERY' || item.type === 'REST';

    // Zone-based coloring for WORK intervals
    // Z7 is near-black — swap to light grey in dark mode for visibility
    const zoneColors = isCycling ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
    let zoneColor =
      isWork && item.zone != null && item.zone >= 1
        ? zoneColors[Math.min(item.zone - 1, zoneColors.length - 1)]
        : null;
    if (isDark && zoneColor && item.zone === 7) zoneColor = '#B0B0B0';

    const typeLabel =
      isWork && zoneColor ? `Z${item.zone}` : isWork ? 'Work' : isRecovery ? 'Rec' : item.type;

    return (
      <View
        style={[
          styles.intervalRow,
          isRecovery && styles.intervalRowRecovery,
          index > 0 && styles.intervalRowBorder,
          index > 0 && isDark && styles.intervalRowBorderDark,
        ]}
      >
        <Text style={[styles.indexText, isDark && styles.textLight]}>{index + 1}</Text>
        <Text
          style={[
            styles.typeText,
            isWork && !zoneColor && { color: colors.primary },
            isWork && zoneColor != null && { color: zoneColor },
            isRecovery && { color: colors.success },
          ]}
          numberOfLines={1}
        >
          {typeLabel}
        </Text>
        <View style={styles.statsRow}>
          <Text style={[styles.colStat, isDark && styles.textLight]}>
            {formatDistance(item.distance, isMetric)}
          </Text>
          <Text style={[styles.colStat, isDark && styles.textLight]}>
            {formatDuration(item.moving_time)}
          </Text>
          <Text style={[styles.colStat, isDark && styles.textLight]}>
            {showPace
              ? item.average_speed > 0
                ? formatPace(item.average_speed, isMetric)
                : '--'
              : item.average_speed > 0
                ? formatSpeed(item.average_speed, isMetric)
                : '--'}
          </Text>
          {hasHR && (
            <Text
              style={[
                styles.colStat,
                item.average_heartrate != null && { color: colors.chartPink },
              ]}
            >
              {item.average_heartrate != null ? formatHeartRate(item.average_heartrate) : ''}
            </Text>
          )}
          {hasPower && (
            <Text
              style={[styles.colStat, item.average_watts != null && { color: colors.chartPurple }]}
            >
              {item.average_watts != null ? formatPower(item.average_watts) : ''}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <FlatList
      data={intervals}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      contentContainerStyle={styles.listContent}
      scrollEnabled={false}
      initialNumToRender={20}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 2,
    gap: 6,
  },
  intervalRowRecovery: {},
  intervalRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  intervalRowBorderDark: {
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  indexText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 18,
    textAlign: 'center',
  },
  typeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    width: 40,
  },
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
  },
  colStat: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'right',
    flex: 1,
  },
  textLight: {
    color: colors.textOnDark,
  },
});
