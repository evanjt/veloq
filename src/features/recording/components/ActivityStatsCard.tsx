import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { spacing, typography } from '@/theme';
import { useMetricSystem } from '@/shared/app';
import type { ActivityType } from '@/types';
import type { ActivitySummary } from '@/features/recording/hooks/useActivitySummary';
import { recordingStats } from '@/features/recording/lib/recordingStats';

export interface ActivityStatsCardProps {
  summary: ActivitySummary;
  activityType: ActivityType;
  textPrimary: string;
  textSecondary: string;
}

/**
 * Compact stats grid for an activity being reviewed: moving time, elapsed
 * time when pauses made it longer, and every distance, gain and average the
 * save will write.
 */
export function ActivityStatsCard({
  summary,
  activityType,
  textPrimary,
  textSecondary,
}: ActivityStatsCardProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const stats = recordingStats(
    {
      activityType,
      movingSeconds: summary.duration,
      elapsedSeconds: summary.elapsed,
      distanceMeters: summary.distance,
      elevationGain: summary.elevationGain,
      avgHeartrate: summary.avgHeartrate,
      avgPower: summary.avgPower,
    },
    isMetric,
    t
  );

  return (
    <View style={styles.compactStats}>
      {stats.map((stat) => (
        <View key={stat.key} style={styles.compactStatItem}>
          <Text style={[styles.compactStatValue, { color: textPrimary }]}>
            {stat.key === 'elevationGain' ? `${stat.value} ↑` : stat.value}
          </Text>
          <Text style={[styles.compactStatLabel, { color: textSecondary }]}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  compactStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    rowGap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  compactStatItem: {
    alignItems: 'center',
    minWidth: '33%',
  },
  compactStatValue: {
    ...typography.metricValue,
  },
  compactStatLabel: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});
