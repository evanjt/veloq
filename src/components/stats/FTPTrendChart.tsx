import React, { useMemo } from 'react';
import { View, StyleSheet, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { CartesianChart, Line, Area } from 'victory-native';
import { Circle, LinearGradient, vec } from '@shopify/react-native-skia';
import { colors, spacing, typography } from '@/theme';
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

  const chartData = useMemo(() => {
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
          padding={{ left: 0, right: 0, top: 8, bottom: 16 }}
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
                    color="#FFFFFF"
                  />
                </>
              )}
            </>
          )}
        </CartesianChart>

        {/* X-axis labels */}
        <View style={styles.xAxisLabels}>
          {chartData.length > 0 && (
            <>
              <Text style={[styles.axisLabel, isDark && styles.textDark]}>
                {formatDate(chartData[0].date)}
              </Text>
              <Text style={[styles.axisLabel, isDark && styles.textDark]}>
                {formatDate(chartData[chartData.length - 1].date)}
              </Text>
            </>
          )}
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
    fontSize: 12,
    color: colors.textSecondary,
  },
  ftpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ftpValue: {
    fontSize: 32,
    fontWeight: '700',
  },
  changeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  positive: {
    backgroundColor: colors.success + '20',
  },
  negative: {
    backgroundColor: colors.error + '20',
  },
  changeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  changeSubtext: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textDark: {
    color: '#AAA',
  },
  chartWrapper: {
    flex: 1,
    position: 'relative',
  },
  xAxisLabels: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    right: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
