import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, Area } from 'victory-native';
import { Circle, LinearGradient, vec } from '@shopify/react-native-skia';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { eFTPPoint } from '@/types';

interface FTPTrendChartProps {
  /** eFTP history data points */
  data?: eFTPPoint[];
  /** Current eFTP value */
  currentFTP?: number;
  /** Chart height */
  height?: number;
}

// Chart color - yellow/gold for FTP
const CHART_COLOR = '#FFB300';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short' });
}

export function FTPTrendChart({
  data,
  currentFTP,
  height = 180,
}: FTPTrendChartProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // All hooks must be called before any conditional returns
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d, idx) => ({
      x: idx,
      y: d.eftp,
      date: d.date,
    }));
  }, [data]);

  const { minFTP, maxFTP, latestFTP, ftpChange, changePercent } = useMemo(() => {
    if (chartData.length === 0) {
      return { minFTP: 200, maxFTP: 300, latestFTP: 0, ftpChange: 0, changePercent: 0 };
    }

    const values = chartData.map(d => d.y);
    const latest = values[values.length - 1];
    const threeMonthsAgo = values.length > 3 ? values[values.length - 4] : values[0];
    const change = latest - threeMonthsAgo;
    const percent = threeMonthsAgo > 0 ? (change / threeMonthsAgo) * 100 : 0;

    return {
      minFTP: Math.min(...values) - 10,
      maxFTP: Math.max(...values) + 10,
      latestFTP: currentFTP || latest,
      ftpChange: change,
      changePercent: percent,
    };
  }, [chartData, currentFTP]);

  const isImproving = ftpChange >= 0;

  // Show empty state if no data
  if (!data || data.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            No FTP data available
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            Complete power-based activities to see your FTP trend
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with current FTP */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.label, isDark && styles.textDark]}>Estimated FTP</Text>
          <View style={styles.ftpRow}>
            <Text style={[styles.ftpValue, { color: CHART_COLOR }]}>{latestFTP}W</Text>
            <View style={[styles.changeBadge, isImproving ? styles.positive : styles.negative]}>
              <Text style={styles.changeText}>
                {isImproving ? '▲' : '▼'} {Math.abs(ftpChange)}W
              </Text>
            </View>
          </View>
          <Text style={[styles.changeSubtext, isDark && styles.textDark]}>
            {isImproving ? '+' : ''}{changePercent.toFixed(1)}% from 3 months ago
          </Text>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['y']}
          domain={{ y: [minFTP, maxFTP] }}
          padding={{ left: 0, right: 0, top: 8, bottom: 0 }}
        >
          {({ points, chartBounds }) => (
            <>
              <Area
                points={points.y}
                y0={chartBounds.bottom}
                curveType="natural"
              >
                <LinearGradient
                  start={vec(0, chartBounds.top)}
                  end={vec(0, chartBounds.bottom)}
                  colors={[CHART_COLOR + '60', CHART_COLOR + '10']}
                />
              </Area>
              <Line
                points={points.y}
                color={CHART_COLOR}
                strokeWidth={2.5}
                curveType="natural"
              />
              {/* Latest point indicator */}
              {points.y.length > 0 && points.y[points.y.length - 1].x != null && points.y[points.y.length - 1].y != null && (
                <>
                  <Circle
                    cx={points.y[points.y.length - 1].x!}
                    cy={points.y[points.y.length - 1].y!}
                    r={6}
                    color={CHART_COLOR}
                  />
                  <Circle
                    cx={points.y[points.y.length - 1].x!}
                    cy={points.y[points.y.length - 1].y!}
                    r={3}
                    color={colors.textOnDark}
                  />
                </>
              )}
            </>
          )}
        </CartesianChart>

        {/* X-axis labels */}
        <View style={styles.xAxisOverlay} pointerEvents="none">
          {chartData.length > 0 && (
            <>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatDate(chartData[0].date)}
              </Text>
              <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
                {formatDate(chartData[chartData.length - 1].date)}
              </Text>
            </>
          )}
        </View>

        {/* Y-axis labels */}
        <View style={styles.yAxisOverlay} pointerEvents="none">
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(maxFTP)}w</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round((minFTP + maxFTP) / 2)}w</Text>
          <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>{Math.round(minFTP)}w</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  ftpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ftpValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  changeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: layout.borderRadius,
  },
  positive: {
    backgroundColor: colors.success + '20',
  },
  negative: {
    backgroundColor: colors.error + '20',
  },
  changeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.success,
  },
  changeSubtext: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  xAxisOverlay: {
    position: 'absolute',
    bottom: 0,
    left: spacing.xs,
    right: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  yAxisOverlay: {
    position: 'absolute',
    top: spacing.sm,
    bottom: spacing.md,
    left: spacing.xs,
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  axisLabelDark: {
    color: darkColors.textSecondary,
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
