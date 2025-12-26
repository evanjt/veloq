import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, darkColors, spacing, typography, layout, opacity } from '@/theme';
import type { WellnessData } from '@/types';

interface WellnessDashboardProps {
  /** Wellness data array */
  data?: WellnessData[];
}

interface MetricTrend {
  current: number | null;
  previous: number | null;
  change: number;
  trend: 'up' | 'down' | 'stable';
  unit: string;
  label: string;
  icon: string;
  goodDirection: 'up' | 'down' | 'stable';
}

function formatSleepHours(seconds: number | undefined): string {
  if (!seconds) return '-';
  const hours = seconds / 3600;
  return hours.toFixed(1);
}

function getAverage(data: WellnessData[], key: keyof WellnessData, days: number): number | null {
  const recent = data.slice(0, days).filter(d => d[key] != null);
  if (recent.length === 0) return null;
  const sum = recent.reduce((acc, d) => acc + (d[key] as number || 0), 0);
  return sum / recent.length;
}

export function WellnessDashboard({ data }: WellnessDashboardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Show empty state if no data
  if (!data || data.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Wellness</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No wellness data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Connect a wearable or log wellness data in Intervals.icu
          </Text>
        </View>
      </View>
    );
  }

  const sourceData = data;

  const metrics: MetricTrend[] = useMemo(() => {
    const sorted = [...sourceData].sort((a, b) => b.id.localeCompare(a.id));

    const currentHRV = sorted[0]?.hrv ?? null;
    const prevHRV = getAverage(sorted.slice(1), 'hrv', 7);

    const currentRHR = sorted[0]?.restingHR ?? null;
    const prevRHR = getAverage(sorted.slice(1), 'restingHR', 7);

    const currentSleep = sorted[0]?.sleepSecs ?? null;
    const prevSleep = getAverage(sorted.slice(1), 'sleepSecs', 7);

    const currentSleepScore = sorted[0]?.sleepScore ?? null;
    const prevSleepScore = getAverage(sorted.slice(1), 'sleepScore', 7);

    // Find the most recent weight (look back if today is null)
    const weightRecord = sorted.find(d => d.weight != null);
    const currentWeight = weightRecord?.weight ?? null;
    const prevWeight = getAverage(sorted.filter(d => d !== weightRecord), 'weight', 7);

    const getTrend = (current: number | null, prev: number | null): 'up' | 'down' | 'stable' => {
      if (current === null || prev === null) return 'stable';
      const diff = current - prev;
      if (Math.abs(diff) < 0.5) return 'stable';
      return diff > 0 ? 'up' : 'down';
    };

    const getChange = (current: number | null, prev: number | null): number => {
      if (current === null || prev === null) return 0;
      return current - prev;
    };

    return [
      {
        label: 'HRV',
        current: currentHRV,
        previous: prevHRV,
        change: getChange(currentHRV, prevHRV),
        trend: getTrend(currentHRV, prevHRV),
        unit: 'ms',
        icon: '💓',
        goodDirection: 'up',
      },
      {
        label: 'Resting HR',
        current: currentRHR,
        previous: prevRHR,
        change: getChange(currentRHR, prevRHR),
        trend: getTrend(currentRHR, prevRHR),
        unit: 'bpm',
        icon: '❤️',
        goodDirection: 'down',
      },
      {
        label: 'Sleep',
        current: currentSleep ? currentSleep / 3600 : null,
        previous: prevSleep ? prevSleep / 3600 : null,
        change: getChange(currentSleep ? currentSleep / 3600 : null, prevSleep ? prevSleep / 3600 : null),
        trend: getTrend(currentSleep, prevSleep),
        unit: 'hrs',
        icon: '😴',
        goodDirection: 'up',
      },
      {
        label: 'Sleep Score',
        current: currentSleepScore,
        previous: prevSleepScore,
        change: getChange(currentSleepScore, prevSleepScore),
        trend: getTrend(currentSleepScore, prevSleepScore),
        unit: '',
        icon: '💯',
        goodDirection: 'up',
      },
      {
        label: 'Weight',
        current: currentWeight,
        previous: prevWeight,
        change: getChange(currentWeight, prevWeight),
        trend: getTrend(currentWeight, prevWeight),
        unit: 'kg',
        icon: '⚖️',
        goodDirection: 'stable',
      },
    ];
  }, [sourceData]);

  const getTrendColor = (metric: MetricTrend): string => {
    if (metric.trend === 'stable') return colors.textSecondary;
    const isGood = (metric.trend === metric.goodDirection) ||
                   (metric.goodDirection === 'stable');
    return isGood ? colors.success : colors.warning;
  };

  const getTrendIcon = (trend: 'up' | 'down' | 'stable'): string => {
    if (trend === 'up') return '▲';
    if (trend === 'down') return '▼';
    return '●';
  };

  // Get insight based on metrics
  const insight = useMemo(() => {
    const hrvMetric = metrics.find(m => m.label === 'HRV');
    const rhrMetric = metrics.find(m => m.label === 'Resting HR');

    if (hrvMetric?.trend === 'up' && rhrMetric?.trend === 'down') {
      return { text: 'Good recovery - you\'re adapting well', color: colors.success };
    }
    if (hrvMetric?.trend === 'down' && rhrMetric?.trend === 'up') {
      return { text: 'Consider extra recovery today', color: colors.warning };
    }
    return { text: 'Metrics look stable', color: colors.textSecondary };
  }, [metrics]);

  // Visual trend indicators for key metrics
  const trendIndicators = useMemo(() => {
    const hrvMetric = metrics.find(m => m.label === 'HRV');
    const rhrMetric = metrics.find(m => m.label === 'Resting HR');
    const sleepMetric = metrics.find(m => m.label === 'Sleep');

    const getArrow = (trend: 'up' | 'down' | 'stable') => {
      if (trend === 'up') return '▲';
      if (trend === 'down') return '▼';
      return '●';
    };

    const getColor = (trend: 'up' | 'down' | 'stable', goodDirection: 'up' | 'down' | 'stable') => {
      if (trend === 'stable') return colors.textSecondary;
      if (trend === goodDirection) return colors.success;
      return colors.warning;
    };

    return [
      {
        label: 'HRV',
        arrow: getArrow(hrvMetric?.trend || 'stable'),
        color: getColor(hrvMetric?.trend || 'stable', 'up'),
        value: hrvMetric?.current != null ? Math.round(hrvMetric.current) : null,
      },
      {
        label: 'RHR',
        arrow: getArrow(rhrMetric?.trend || 'stable'),
        color: getColor(rhrMetric?.trend || 'stable', 'down'),
        value: rhrMetric?.current != null ? Math.round(rhrMetric.current) : null,
      },
      {
        label: 'Sleep',
        arrow: getArrow(sleepMetric?.trend || 'stable'),
        color: getColor(sleepMetric?.trend || 'stable', 'up'),
        value: sleepMetric?.current != null ? sleepMetric.current.toFixed(1) : null,
      },
    ];
  }, [metrics]);

  return (
    <View style={styles.container}>
      <View style={styles.trendRow}>
        {trendIndicators.map((indicator, idx) => (
          <View key={indicator.label} style={styles.trendItem}>
            <Text style={[styles.trendLabel, isDark && styles.textDark]}>{indicator.label}</Text>
            <View style={styles.trendValueRow}>
              {indicator.value !== null ? (
                <>
                  <Text style={[styles.trendValue, isDark && styles.textLight]}>
                    {indicator.value}
                  </Text>
                  <Text style={[styles.trendArrow, { color: indicator.color }]}>
                    {indicator.arrow}
                  </Text>
                </>
              ) : (
                <Text style={[styles.trendValue, isDark && styles.textDark]}>-</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  trendRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  trendItem: {
    alignItems: 'center',
  },
  trendLabel: {
    fontSize: typography.micro.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  trendValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  trendArrow: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    marginLeft: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  date: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  metricCard: {
    width: '50%',
    paddingHorizontal: 4,
    marginBottom: spacing.sm,
  },
  metricCardDark: {},
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  metricIcon: {
    fontSize: typography.bodySmall.fontSize,
    marginRight: 6,
  },
  metricLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricUnit: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  metricChange: {
    fontSize: typography.label.fontSize,
    fontWeight: '500',
    marginTop: 2,
  },
  insightBox: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    borderWidth: 1,
    backgroundColor: opacity.overlay.subtle,
  },
  insightText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
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
