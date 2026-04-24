import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { formatDistance, formatDuration } from '@/lib';
import { spacing, typography } from '@/theme';
import { useMetricSystem } from '@/hooks';
import type { ActivitySummary } from '@/hooks/recording/useActivitySummary';

export interface ActivityStatsCardProps {
  summary: Pick<ActivitySummary, 'duration' | 'distance' | 'elevationGain'>;
  textPrimary: string;
  textSecondary: string;
}

/**
 * Compact horizontal stats row showing duration, distance, and elevation
 * gain for an activity being reviewed. Distance and elevation cells are
 * conditionally rendered — they only appear when the corresponding value
 * is > 0.
 */
export function ActivityStatsCard({ summary, textPrimary, textSecondary }: ActivityStatsCardProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  return (
    <View style={styles.compactStats}>
      <View style={styles.compactStatItem}>
        <Text style={[styles.compactStatValue, { color: textPrimary }]}>
          {formatDuration(summary.duration)}
        </Text>
        <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
          {t('recording.durationLabel', 'Duration')}
        </Text>
      </View>
      {summary.distance > 0 && (
        <View style={styles.compactStatItem}>
          <Text style={[styles.compactStatValue, { color: textPrimary }]}>
            {formatDistance(summary.distance, isMetric)}
          </Text>
          <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
            {t('recording.fields.distance', 'Distance')}
          </Text>
        </View>
      )}
      {summary.elevationGain > 0 && (
        <View style={styles.compactStatItem}>
          <Text style={[styles.compactStatValue, { color: textPrimary }]}>
            {Math.round(summary.elevationGain)} {isMetric ? t('units.m', 'm') : t('units.ft', 'ft')}{' '}
            ↑
          </Text>
          <Text style={[styles.compactStatLabel, { color: textSecondary }]}>
            {t('recording.elevation', 'Elevation')}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  compactStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  compactStatItem: {
    alignItems: 'center',
  },
  compactStatValue: {
    ...typography.metricValue,
    fontVariant: ['tabular-nums'],
  },
  compactStatLabel: {
    ...typography.caption,
    marginTop: 2,
  },
});
