import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS, DEFAULT_POWER_ZONES, DEFAULT_HR_ZONES } from '@/hooks';
import type { ZoneDistribution } from '@/types';

interface ZoneDistributionChartProps {
  /** Zone distribution data */
  data?: ZoneDistribution[];
  /** Type of zones to display */
  type?: 'power' | 'hr';
  /** Chart height */
  height?: number;
  /** Title override */
  title?: string;
  /** Time period label */
  periodLabel?: string;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

export const ZoneDistributionChart = React.memo(function ZoneDistributionChart({
  data,
  type = 'power',
  height = 200,
  title,
  periodLabel = 'Last 30 days',
}: ZoneDistributionChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const displayTitle = title || (type === 'power' ? 'Power Zones' : 'Heart Rate Zones');

  // All hooks must be called before any conditional returns
  // Calculate percentages if data is provided
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const totalSeconds = data.reduce((sum, d) => sum + d.seconds, 0);
    return data.map(d => ({
      ...d,
      percentage: totalSeconds > 0 ? Math.round((d.seconds / totalSeconds) * 100) : 0,
    }));
  }, [data]);

  // Find max for bar scaling
  const maxPercentage = useMemo(() => {
    if (processedData.length === 0) return 1;
    return Math.max(...processedData.map(d => d.percentage), 1);
  }, [processedData]);

  // Show empty state if no data
  if (!data || data.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{displayTitle}</Text>
          <Text style={[styles.subtitle, isDark && styles.textDark]}>{periodLabel}</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No zone data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete activities with {type === 'power' ? 'power meter' : 'heart rate'} data to see zone distribution
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{displayTitle}</Text>
        <Text style={[styles.subtitle, isDark && styles.textDark]}>{periodLabel}</Text>
      </View>

      {/* Zone bars */}
      <View style={styles.barsContainer}>
        {processedData.map((zone, idx) => (
          <View key={zone.zone} style={styles.barRow}>
            {/* Zone label */}
            <View style={styles.barLabel}>
              <View style={[styles.zoneDot, { backgroundColor: zone.color }]} />
              <Text style={[styles.zoneName, isDark && styles.textDark]} numberOfLines={1}>
                Z{zone.zone} {zone.name}
              </Text>
            </View>

            {/* Bar */}
            <View style={styles.barWrapper}>
              <View
                style={[
                  styles.bar,
                  {
                    width: `${(zone.percentage / maxPercentage) * 100}%`,
                    backgroundColor: zone.color,
                  },
                ]}
              />
            </View>

            {/* Percentage & time */}
            <View style={styles.barValue}>
              <Text style={[styles.percentage, { color: zone.color }]}>
                {zone.percentage}%
              </Text>
              <Text style={[styles.duration, isDark && styles.textDark]}>
                {formatDuration(zone.seconds)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Total time */}
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, isDark && styles.textDark]}>Total Time</Text>
        <Text style={[styles.totalValue, isDark && styles.textLight]}>
          {formatDuration(processedData.reduce((sum, d) => sum + d.seconds, 0))}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  barsContainer: {
    marginBottom: spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
  },
  barLabel: {
    width: 90,
    flexDirection: 'row',
    alignItems: 'center',
  },
  zoneDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  zoneName: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    flex: 1,
  },
  barWrapper: {
    flex: 1,
    height: spacing.md,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
    marginHorizontal: spacing.sm,
  },
  bar: {
    height: '100%',
    borderRadius: layout.borderRadiusSm,
    minWidth: spacing.xs,
  },
  barValue: {
    width: 60,
    alignItems: 'flex-end',
  },
  percentage: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
  },
  duration: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
