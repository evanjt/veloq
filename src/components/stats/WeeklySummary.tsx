import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, spacing, typography } from '@/theme';
import type { Activity } from '@/types';

interface WeeklySummaryProps {
  /** Activities for the current week */
  activities?: Activity[];
  /** Total training load (TSS) for the week */
  weeklyTSS?: number;
  /** Previous week's TSS for comparison */
  previousWeekTSS?: number;
  /** Acute:Chronic ratio (if available) */
  acuteChronicRatio?: number;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

export function WeeklySummary({
  activities,
  weeklyTSS,
  previousWeekTSS,
  acuteChronicRatio,
}: WeeklySummaryProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Show empty state if no activities
  if (!activities || activities.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>This Week</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No activities this week
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete activities to see your weekly summary
          </Text>
        </View>
      </View>
    );
  }

  const stats = useMemo(() => {
    const count = activities.length;
    const duration = activities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
    const distance = activities.reduce((sum, a) => sum + (a.distance || 0), 0);

    return {
      activities: count,
      duration,
      distance,
      tss: weeklyTSS || 0,
      previousTss: previousWeekTSS || 0,
      acuteChronicRatio: acuteChronicRatio || 0,
    };
  }, [activities, weeklyTSS, previousWeekTSS, acuteChronicRatio]);

  const tssChange = stats.previousTss > 0
    ? ((stats.tss - stats.previousTss) / stats.previousTss) * 100
    : 0;

  const isLoadIncreasing = tssChange > 0;

  // Acute:Chronic ratio warnings
  const getACRStatus = (ratio: number) => {
    if (ratio < 0.8) return { color: colors.warning, text: 'Undertrained', icon: '⚠️' };
    if (ratio > 1.5) return { color: colors.error, text: 'High injury risk', icon: '🔴' };
    if (ratio > 1.3) return { color: colors.warning, text: 'Elevated load', icon: '⚠️' };
    return { color: colors.success, text: 'Optimal range', icon: '✓' };
  };

  const acrStatus = stats.acuteChronicRatio > 0 ? getACRStatus(stats.acuteChronicRatio) : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>This Week</Text>
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>{stats.activities}</Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>Activities</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {formatDuration(stats.duration)}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>Duration</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>
            {formatDistance(stats.distance)}
          </Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>Distance</Text>
        </View>

        <View style={styles.statItem}>
          <Text style={[styles.statValue, isDark && styles.textLight]}>{stats.tss}</Text>
          <Text style={[styles.statLabel, isDark && styles.textDark]}>Load (TSS)</Text>
        </View>
      </View>

      {/* Comparison with last week */}
      {stats.previousTss > 0 && (
        <View style={styles.comparisonRow}>
          <Text style={[styles.comparisonLabel, isDark && styles.textDark]}>
            vs last week
          </Text>
          <Text
            style={[
              styles.comparisonValue,
              { color: isLoadIncreasing ? colors.warning : colors.success },
            ]}
          >
            {isLoadIncreasing ? '▲' : '▼'} {Math.abs(tssChange).toFixed(0)}%
          </Text>
        </View>
      )}

      {/* Acute:Chronic ratio warning */}
      {acrStatus && (
        <View style={[styles.warningBox, { borderColor: acrStatus.color }]}>
          <Text style={[styles.warningText, { color: acrStatus.color }]}>
            {acrStatus.icon} A:C Ratio {stats.acuteChronicRatio.toFixed(2)} - {acrStatus.text}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  statItem: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  comparisonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  comparisonLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  comparisonValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  warningBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  warningText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
