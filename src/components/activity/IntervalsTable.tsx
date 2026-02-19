import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
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
import { colors, darkColors, spacing, typography, layout } from '@/theme';
import type { ActivityInterval, ActivityType } from '@/types';

interface IntervalsTableProps {
  intervals: ActivityInterval[];
  activityType: ActivityType;
  isMetric: boolean;
  isDark: boolean;
}

export function IntervalsTable({ intervals, activityType, isMetric, isDark }: IntervalsTableProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);

  // Summary stats across WORK intervals
  const summary = useMemo(() => {
    const workIntervals = intervals.filter((i) => i.type === 'WORK');
    if (workIntervals.length === 0) return null;
    const totalDist = workIntervals.reduce((s, i) => s + i.distance, 0);
    const totalTime = workIntervals.reduce((s, i) => s + i.moving_time, 0);
    const avgHR =
      workIntervals.filter((i) => i.average_heartrate).length > 0
        ? workIntervals.reduce((s, i) => s + (i.average_heartrate || 0), 0) /
          workIntervals.filter((i) => i.average_heartrate).length
        : undefined;
    const avgPower =
      workIntervals.filter((i) => i.average_watts).length > 0
        ? workIntervals.reduce((s, i) => s + (i.average_watts || 0), 0) /
          workIntervals.filter((i) => i.average_watts).length
        : undefined;
    return { count: workIntervals.length, totalDist, totalTime, avgHR, avgPower };
  }, [intervals]);

  const isCycling = isCyclingActivity(activityType);

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

    const badgeText =
      isWork && zoneColor
        ? `Z${item.zone}`
        : isWork
          ? t('activityDetail.intervalWork')
          : isRecovery
            ? t('activityDetail.intervalRecovery')
            : item.type;

    return (
      <View
        style={[
          styles.intervalCard,
          isDark && styles.intervalCardDark,
          isRecovery && styles.intervalCardRecovery,
          isRecovery && isDark && styles.intervalCardRecoveryDark,
          isWork && {
            borderLeftWidth: 3,
            borderLeftColor: zoneColor || colors.primary,
          },
        ]}
      >
        <View style={styles.intervalHeader}>
          <View style={styles.intervalIndex}>
            <Text style={[styles.indexText, isDark && styles.textLight]}>{index + 1}</Text>
          </View>
          <View
            style={[
              styles.typeBadge,
              isWork && !zoneColor && styles.typeBadgeWork,
              isWork && zoneColor != null && { backgroundColor: zoneColor + '25' },
              isRecovery && styles.typeBadgeRecovery,
            ]}
          >
            <Text
              style={[
                styles.typeBadgeText,
                isWork && !zoneColor && styles.typeBadgeTextWork,
                isWork && zoneColor != null && { color: zoneColor },
                isRecovery && styles.typeBadgeTextRecovery,
              ]}
            >
              {badgeText}
            </Text>
          </View>
          {item.label && (
            <Text style={[styles.intervalLabel, isDark && styles.textMuted]} numberOfLines={1}>
              {item.label}
            </Text>
          )}
        </View>

        <View style={styles.intervalStats}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatDistance(item.distance, isMetric)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.textMuted]}>
              {t('activity.distance')}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatDuration(item.moving_time)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.textMuted]}>
              {t('activity.duration')}
            </Text>
          </View>
          {showPace ? (
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {item.average_speed > 0 ? formatPace(item.average_speed, isMetric) : '--'}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                {t('metrics.pace')}
              </Text>
            </View>
          ) : (
            <View style={styles.statItem}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {item.average_speed > 0 ? formatSpeed(item.average_speed, isMetric) : '--'}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                {t('activity.speed')}
              </Text>
            </View>
          )}
          {item.average_heartrate != null && (
            <View style={styles.statItem}>
              <Text
                style={[styles.statValue, isDark && styles.textLight, { color: colors.chartPink }]}
              >
                {formatHeartRate(item.average_heartrate)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>{t('metrics.hr')}</Text>
            </View>
          )}
          {item.average_watts != null && (
            <View style={styles.statItem}>
              <Text
                style={[
                  styles.statValue,
                  isDark && styles.textLight,
                  { color: colors.chartPurple },
                ]}
              >
                {formatPower(item.average_watts)}
              </Text>
              <Text style={[styles.statLabel, isDark && styles.textMuted]}>
                {t('activity.pwr')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const ListHeader = summary ? (
    <View style={[styles.summaryCard, isDark && styles.summaryCardDark]}>
      <Text style={[styles.summaryTitle, isDark && styles.textLight]}>
        {summary.count} {t('activityDetail.intervalWork')}
      </Text>
      <View style={styles.summaryStats}>
        <Text style={[styles.summaryStat, isDark && styles.textMuted]}>
          {formatDistance(summary.totalDist, isMetric)}
        </Text>
        <Text style={[styles.summaryDivider, isDark && styles.textMuted]}>·</Text>
        <Text style={[styles.summaryStat, isDark && styles.textMuted]}>
          {formatDuration(summary.totalTime)}
        </Text>
        {summary.avgHR != null && (
          <>
            <Text style={[styles.summaryDivider, isDark && styles.textMuted]}>·</Text>
            <Text style={[styles.summaryStat, isDark && styles.textMuted]}>
              {formatHeartRate(summary.avgHR)}
            </Text>
          </>
        )}
        {summary.avgPower != null && (
          <>
            <Text style={[styles.summaryDivider, isDark && styles.textMuted]}>·</Text>
            <Text style={[styles.summaryStat, isDark && styles.textMuted]}>
              {formatPower(summary.avgPower)}
            </Text>
          </>
        )}
      </View>
    </View>
  ) : null;

  return (
    <FlatList
      data={intervals}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      ListHeaderComponent={ListHeader}
      contentContainerStyle={styles.listContent}
      scrollEnabled={false}
      initialNumToRender={20}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  summaryCardDark: {
    backgroundColor: darkColors.surface,
  },
  summaryTitle: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  summaryStat: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  summaryDivider: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginHorizontal: 6,
  },
  intervalCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  intervalCardDark: {
    backgroundColor: darkColors.surface,
  },
  intervalCardRecovery: {
    opacity: 0.7,
    backgroundColor: colors.background,
  },
  intervalCardRecoveryDark: {
    backgroundColor: darkColors.background,
  },
  intervalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  intervalIndex: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textOnDark,
  },
  typeBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  typeBadgeWork: {
    backgroundColor: 'rgba(252, 76, 2, 0.15)',
  },
  typeBadgeRecovery: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  typeBadgeTextWork: {
    color: colors.primary,
  },
  typeBadgeTextRecovery: {
    color: colors.success,
  },
  intervalLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    flex: 1,
  },
  intervalStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 50,
  },
  statValue: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginTop: 1,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
