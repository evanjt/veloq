import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { measuresPower } from '@/shared/activity/activityUtils';
import { intervalTypeLabel } from '@/features/activity/lib/intervalTypeLabel';
import {
  formatDistance,
  formatDuration,
  formatSportSpeed,
  formatHeartRate,
  formatPower,
} from '@/shared/format/format';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import {
  colors,
  darkColors,
  spacing,
  typography,
  ink,
  colorWithOpacity,
  themedStyles,
  type Palette,
} from '@/theme';
import type { ActivityInterval, ActivityType } from '@/types';
import { ABSENT, absentLabel } from '@/shared/format/absent';

interface IntervalsTableProps {
  intervals: ActivityInterval[];
  activityType: ActivityType;
  isMetric: boolean;
  isDark: boolean;
}

export function IntervalsTable({ intervals, activityType, isMetric, isDark }: IntervalsTableProps) {
  const { t } = useTranslation();
  const styles = themedStyles(makeStyles, isDark);
  const hasPowerZones = measuresPower(activityType);
  const hasHR = useMemo(() => intervals.some((i) => i.average_heartrate != null), [intervals]);
  const hasPower = useMemo(() => intervals.some((i) => i.average_watts != null), [intervals]);

  const renderItem = ({ item, index }: { item: ActivityInterval; index: number }) => {
    const isWork = item.type === 'WORK';
    const isRecovery = item.type === 'RECOVERY' || item.type === 'REST';

    // Zone-based coloring for WORK intervals
    // Z7 is near-black - swap to light grey in dark mode for visibility
    const zoneColors = hasPowerZones ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
    let zoneColor =
      isWork && item.zone != null && item.zone >= 1
        ? zoneColors[Math.min(item.zone - 1, zoneColors.length - 1)]
        : null;
    if (isDark && zoneColor && item.zone === 7) zoneColor = darkColors.zone7;

    const distance = item.distance != null ? formatDistance(item.distance, isMetric) : ABSENT;
    const duration = item.moving_time != null ? formatDuration(item.moving_time) : ABSENT;
    const speed =
      item.average_speed == null || item.average_speed <= 0
        ? ABSENT
        : formatSportSpeed(item.average_speed, activityType, isMetric);
    const heartRate =
      item.average_heartrate != null ? formatHeartRate(item.average_heartrate) : ABSENT;
    const power = item.average_watts != null ? formatPower(item.average_watts) : ABSENT;

    const typeLabel = intervalTypeLabel({
      type: item.type,
      zone: item.zone,
      label: item.label,
      zoneColoured: zoneColor != null,
    });

    return (
      <View
        style={[
          styles.intervalRow,
          isRecovery && styles.intervalRowRecovery,
          index > 0 && styles.intervalRowBorder,
        ]}
      >
        <Text style={styles.indexText}>{index + 1}</Text>
        <Text
          style={[
            styles.typeText,
            isWork && !zoneColor && { color: isDark ? darkColors.linkTeal : colors.linkTeal },
            isWork && zoneColor != null && { color: zoneColor },
            isRecovery && { color: isDark ? darkColors.successDeep : colors.successDeep },
          ]}
          numberOfLines={1}
        >
          {typeLabel}
        </Text>
        <View style={styles.statsRow}>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(distance, t)}>
            {distance}
          </Text>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(duration, t)}>
            {duration}
          </Text>
          <Text style={styles.colStat} accessibilityLabel={absentLabel(speed, t)}>
            {speed}
          </Text>
          {hasHR && (
            <Text
              style={[
                styles.colStat,
                item.average_heartrate != null && {
                  color: isDark ? darkColors.chartPinkText : colors.chartPinkText,
                },
              ]}
              accessibilityLabel={absentLabel(heartRate, t)}
            >
              {heartRate}
            </Text>
          )}
          {hasPower && (
            <Text
              style={[
                styles.colStat,
                item.average_watts != null && {
                  color: isDark ? darkColors.chartPurpleText : colors.chartPurpleText,
                },
              ]}
              accessibilityLabel={absentLabel(power, t)}
            >
              {power}
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

const makeStyles = (palette: Palette, isDark: boolean) =>
  StyleSheet.create({
    listContent: {
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xxs,
      gap: spacing.xsPlus,
    },
    intervalRowRecovery: {},
    intervalRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colorWithOpacity(isDark ? ink.white : ink.black, 0.08),
    },
    indexText: {
      ...typography.tableValue,
      fontSize: typography.caption.fontSize,
      lineHeight: typography.caption.lineHeight,
      fontWeight: '600',
      color: palette.textSecondary,
      width: 18,
      textAlign: 'center',
    },
    typeText: {
      fontSize: typography.micro.fontSize,
      fontWeight: '600',
      color: palette.textSecondary,
      textTransform: 'uppercase',
      width: 40,
    },
    statsRow: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.xs,
    },
    colStat: {
      ...typography.tableValue,
      fontSize: typography.caption.fontSize,
      lineHeight: typography.caption.lineHeight,
      fontWeight: '500',
      color: palette.textPrimary,
      textAlign: 'right',
      flex: 1,
    },
  });
