import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Bar, useChartPressState } from 'victory-native';
import { LinearGradient, vec, Shadow, RoundedRect, Group } from '@shopify/react-native-skia';
import { colors, spacing, typography } from '@/theme';
import { usePowerCurve, formatPowerCurveForChart, POWER_CURVE_DURATIONS } from '@/hooks';

interface PowerCurveChartProps {
  sport?: string;
  oldest?: string;
  newest?: string;
  height?: number;
  showWattsPerKg?: boolean;
}

// Chart colors - vibrant orange gradient
const CHART_COLOR = '#5B9BD5';
const CHART_COLOR_LIGHT = '#FF8F33';
const CHART_GLOW = 'rgba(255, 107, 0, 0.35)';

export function PowerCurveChart({
  sport,
  oldest,
  newest,
  height = 200,
  showWattsPerKg = false,
}: PowerCurveChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: curve, isLoading, error } = usePowerCurve({ sport, oldest, newest });

  // Format data for chart - using bar chart style
  const chartData = useMemo(() => {
    if (!curve?.secs || !curve?.watts) {
      return [];
    }

    return formatPowerCurveForChart(curve).map((d, idx) => ({
      x: idx,
      label: d.label,
      power: d.power,
      secs: d.secs,
    }));
  }, [curve]);

  const maxPower = useMemo(() => {
    return Math.max(...chartData.map(d => d.power), 100);
  }, [chartData]);

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDark && styles.textDark]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            Power curve data unavailable
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            This feature requires power data from your rides
          </Text>
        </View>
      </View>
    );
  }

  // Show empty state if no data
  if (chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No power curve data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete rides with a power meter to build your power curve
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>Power Curve</Text>
        <Text style={[styles.subtitle, isDark && styles.textDark]}>
          Best efforts this season
        </Text>
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['power']}
          domain={{ y: [0, maxPower * 1.1] }}
          padding={{ left: 8, right: 8, top: 8, bottom: 24 }}
        >
          {({ points, chartBounds }) => (
            <Group>
              <Bar
                points={points.power}
                chartBounds={chartBounds}
                roundedCorners={{ topLeft: 6, topRight: 6 }}
              >
                <LinearGradient
                  start={vec(0, chartBounds.top)}
                  end={vec(0, chartBounds.bottom)}
                  colors={[CHART_COLOR_LIGHT, CHART_COLOR, CHART_COLOR + '80']}
                />
                <Shadow dx={0} dy={2} blur={8} color={CHART_GLOW} />
              </Bar>
            </Group>
          )}
        </CartesianChart>

        {/* X-axis labels */}
        <View style={styles.xAxisLabels}>
          {chartData.map((d, idx) => (
            <View key={idx} style={styles.xAxisLabel}>
              <Text style={[styles.xAxisText, isDark && styles.textDark]}>{d.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Best efforts summary */}
      <View style={styles.summaryRow}>
        {chartData.slice(0, 4).map((d, idx) => (
          <View key={idx} style={styles.summaryItem}>
            <Text style={[styles.summaryLabel, isDark && styles.textDark]}>{d.label}</Text>
            <Text style={[styles.summaryValue, { color: CHART_COLOR }]}>{d.power}W</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textLight: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
  },
  xAxisLabels: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  xAxisLabel: {
    alignItems: 'center',
  },
  xAxisText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingHorizontal: spacing.md,
  },
});
