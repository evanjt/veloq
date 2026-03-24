import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Path, LinearGradient, vec, Line as SkiaLine } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { Insight } from '@/types';

const CHART_HEIGHT = 140;
const CHART_PADDING = { top: 12, bottom: 24, left: 36, right: 12 };
const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 4;

function buildPath(
  data: number[],
  width: number,
  height: number,
  padding: typeof CHART_PADDING,
  yMin: number,
  yMax: number
): string {
  if (data.length < 2) return '';
  const drawW = width - padding.left - padding.right;
  const drawH = height - padding.top - padding.bottom;
  const yRange = yMax - yMin || 1;
  const stepX = drawW / (data.length - 1);
  const points = data.map((v, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + drawH - ((v - yMin) / yRange) * drawH,
  }));
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function buildAreaPath(
  linePath: string,
  data: number[],
  width: number,
  height: number,
  padding: typeof CHART_PADDING
): string {
  if (!linePath) return '';
  const drawW = width - padding.left - padding.right;
  const lastX = padding.left + (data.length - 1) * (drawW / (data.length - 1));
  const bottomY = height - padding.bottom;
  return `${linePath} L ${lastX} ${bottomY} L ${padding.left} ${bottomY} Z`;
}

interface HrvTrendContentProps {
  insight: Insight;
}

export const HrvTrendContent = React.memo(function HrvTrendContent({
  insight,
}: HrvTrendContentProps) {
  const { isDark } = useTheme();

  const sparklineData = insight.supportingData?.sparklineData;
  const avgPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.label.toLowerCase().includes('avg') || dp.label.toLowerCase().includes('average')
  );
  const latestPoint = insight.supportingData?.dataPoints?.find((dp) =>
    dp.label.toLowerCase().includes('latest')
  );
  const daysPoint = insight.supportingData?.dataPoints?.find(
    (dp) => dp.label.toLowerCase().includes('data') || dp.label.toLowerCase().includes('days')
  );

  const avgValue = typeof avgPoint?.value === 'number' ? avgPoint.value : null;
  const latestValue = typeof latestPoint?.value === 'number' ? latestPoint.value : null;
  const daysCount = typeof daysPoint?.value === 'number' ? daysPoint.value : sparklineData?.length;

  const trendColor = insight.iconColor;

  const { linePath, areaPath, yMin, yMax, yTicks } = useMemo(() => {
    if (!sparklineData || sparklineData.length < 2) {
      return { linePath: '', areaPath: '', yMin: 0, yMax: 100, yTicks: [] };
    }
    const min = Math.min(...sparklineData);
    const max = Math.max(...sparklineData);
    const range = max - min || 10;
    const padded = { min: min - range * 0.1, max: max + range * 0.1 };
    const lp = buildPath(
      sparklineData,
      CHART_WIDTH,
      CHART_HEIGHT,
      CHART_PADDING,
      padded.min,
      padded.max
    );
    const ap = buildAreaPath(lp, sparklineData, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);

    // Y-axis ticks: 3-4 evenly spaced values
    const tickCount = 3;
    const step = range / (tickCount - 1);
    const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(min + i * step));

    return { linePath: lp, areaPath: ap, yMin: padded.min, yMax: padded.max, yTicks: ticks };
  }, [sparklineData]);

  const textMuted = isDark ? darkColors.textMuted : colors.textMuted;
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={styles.container}>
      {/* HRV stat row: latest value + average */}
      <View style={[styles.statCard, isDark && styles.statCardDark]}>
        {latestValue != null ? (
          <View style={styles.valueRow}>
            <Text style={[styles.hrvValue, isDark && styles.hrvValueDark]}>{latestValue}</Text>
            <Text style={[styles.hrvUnit, isDark && styles.hrvUnitDark]}>ms</Text>
          </View>
        ) : null}
        <View style={styles.trendRow}>
          <MaterialCommunityIcons name={insight.icon as never} size={18} color={trendColor} />
          {avgValue != null && (avgValue !== latestValue || latestValue == null) ? (
            <Text style={[styles.avgText, isDark && styles.avgTextDark]}>
              {daysCount ? `${daysCount}-day` : '7-day'} avg: {avgValue} ms
            </Text>
          ) : avgValue != null ? (
            <Text style={[styles.avgText, isDark && styles.avgTextDark]}>
              {daysCount ? `${daysCount}-day` : '7-day'} average
            </Text>
          ) : null}
        </View>
      </View>

      {/* Chart with axis labels */}
      {linePath ? (
        <ChartErrorBoundary height={CHART_HEIGHT}>
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            {insight.supportingData?.sparklineLabel ? (
              <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>
                {insight.supportingData.sparklineLabel}
              </Text>
            ) : null}
            <View style={styles.chartWrapper}>
              <Canvas style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
                {/* Horizontal grid lines */}
                {yTicks.map((tick, i) => {
                  const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
                  const yRange = yMax - yMin || 1;
                  const y = CHART_PADDING.top + drawH - ((tick - yMin) / yRange) * drawH;
                  return (
                    <SkiaLine
                      key={`grid-${i}`}
                      p1={vec(CHART_PADDING.left, y)}
                      p2={vec(CHART_WIDTH - CHART_PADDING.right, y)}
                      color={gridColor}
                      strokeWidth={1}
                    />
                  );
                })}
                {/* Area fill */}
                <Path path={areaPath} style="fill">
                  <LinearGradient
                    start={vec(0, CHART_PADDING.top)}
                    end={vec(0, CHART_HEIGHT - CHART_PADDING.bottom)}
                    colors={[`${trendColor}30`, `${trendColor}05`]}
                  />
                </Path>
                {/* Line */}
                <Path path={linePath} style="stroke" strokeWidth={2} color={trendColor} />
              </Canvas>

              {/* Y-axis labels */}
              {yTicks.map((tick, i) => {
                const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
                const yRange = yMax - yMin || 1;
                const y = CHART_PADDING.top + drawH - ((tick - yMin) / yRange) * drawH;
                return (
                  <Text
                    key={`y-${i}`}
                    style={[
                      styles.axisLabel,
                      {
                        position: 'absolute',
                        left: 0,
                        top: y - 6,
                        width: CHART_PADDING.left - 4,
                        textAlign: 'right',
                      },
                      { color: textMuted },
                    ]}
                  >
                    {tick}
                  </Text>
                );
              })}

              {/* X-axis date labels */}
              {sparklineData && sparklineData.length >= 2 ? (
                <View
                  style={[
                    styles.xAxisRow,
                    { left: CHART_PADDING.left, right: CHART_PADDING.right },
                  ]}
                >
                  <Text style={[styles.axisLabel, { color: textMuted }]}>
                    {formatDaysAgo(sparklineData.length - 1)}
                  </Text>
                  <Text style={[styles.axisLabel, { color: textMuted }]}>Today</Text>
                </View>
              ) : null}
            </View>
          </View>
        </ChartErrorBoundary>
      ) : null}
    </View>
  );
});

function formatDaysAgo(days: number): string {
  if (days <= 1) return 'Yesterday';
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  hrvValue: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  hrvValueDark: {
    color: darkColors.textPrimary,
  },
  hrvUnit: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  hrvUnitDark: {
    color: darkColors.textSecondary,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  avgText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  avgTextDark: {
    color: darkColors.textSecondary,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chartLabelDark: {
    color: darkColors.textSecondary,
  },
  chartWrapper: {
    position: 'relative',
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  },
  axisLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  xAxisRow: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
