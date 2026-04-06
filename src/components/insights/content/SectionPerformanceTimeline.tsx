import React, { useMemo, useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Canvas,
  Path,
  Circle,
  LinearGradient,
  vec,
  Line as SkiaLine,
} from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { formatDuration, formatShortDate, safeGetTime } from '@/lib';
import { colors, darkColors, spacing, opacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { SectionPerformanceRecord } from '@/hooks/routes/useSectionPerformances';
import type { LayoutChangeEvent } from 'react-native';

const CHART_HEIGHT = 160;
const CHART_PADDING = { top: 12, bottom: 24, left: 42, right: 12 };

interface SectionPerformanceTimelineProps {
  records: SectionPerformanceRecord[];
  bestRecord: SectionPerformanceRecord | null;
  /** Chart line color */
  lineColor?: string;
}

/**
 * Timeline chart showing section performance (time) over date.
 * X-axis: dates, Y-axis: duration in seconds (inverted so faster = higher).
 * PR is highlighted with a distinct marker.
 */
export const SectionPerformanceTimeline = React.memo(function SectionPerformanceTimeline({
  records,
  bestRecord,
  lineColor = colors.primary,
}: SectionPerformanceTimelineProps) {
  const { isDark } = useTheme();
  const [chartWidth, setChartWidth] = useState(0);
  const onChartLayout = useCallback((e: LayoutChangeEvent) => {
    setChartWidth(e.nativeEvent.layout.width);
  }, []);

  // Sort records chronologically
  const sorted = useMemo(
    () => [...records].sort((a, b) => safeGetTime(a.activityDate) - safeGetTime(b.activityDate)),
    [records]
  );

  const { linePath, areaPath, pointPositions, bestPointIdx, yMin, yMax, yTicks, xLabels } =
    useMemo(() => {
      const empty = {
        linePath: '',
        areaPath: '',
        pointPositions: [] as { x: number; y: number }[],
        bestPointIdx: -1,
        yMin: 0,
        yMax: 100,
        yTicks: [] as number[],
        xLabels: [] as { x: number; label: string }[],
      };
      if (sorted.length < 2 || chartWidth <= 0) return empty;

      const times = sorted.map((r) => r.bestTime);
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const range = maxTime - minTime || 10;
      const paddedMin = minTime - range * 0.1;
      const paddedMax = maxTime + range * 0.1;
      const yRange = paddedMax - paddedMin;

      const drawW = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
      const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

      // Map data to pixel positions
      // Y is inverted: lower time (faster) = higher on chart
      const positions = sorted.map((r, i) => ({
        x: CHART_PADDING.left + (i / (sorted.length - 1)) * drawW,
        y: CHART_PADDING.top + ((r.bestTime - paddedMin) / yRange) * drawH,
      }));

      // Build line path
      let d = `M ${positions[0].x} ${positions[0].y}`;
      for (let i = 1; i < positions.length; i++) {
        d += ` L ${positions[i].x} ${positions[i].y}`;
      }

      // Build area path
      const lastX = positions[positions.length - 1].x;
      const bottomY = CHART_HEIGHT - CHART_PADDING.bottom;
      const area = `${d} L ${lastX} ${bottomY} L ${positions[0].x} ${bottomY} Z`;

      // Find best point index
      const bestIdx = bestRecord
        ? sorted.findIndex((r) => r.activityId === bestRecord.activityId)
        : -1;

      // Y-axis ticks: 3 evenly spaced
      const tickCount = 3;
      const tickStep = range / (tickCount - 1);
      const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(minTime + i * tickStep));

      // X-axis labels: first, middle (if enough points), last
      const labels: { x: number; label: string }[] = [];
      if (sorted.length >= 2) {
        labels.push({ x: positions[0].x, label: formatShortDate(sorted[0].activityDate) });
        if (sorted.length >= 5) {
          const midIdx = Math.floor(sorted.length / 2);
          labels.push({
            x: positions[midIdx].x,
            label: formatShortDate(sorted[midIdx].activityDate),
          });
        }
        labels.push({
          x: positions[positions.length - 1].x,
          label: formatShortDate(sorted[sorted.length - 1].activityDate),
        });
      }

      return {
        linePath: d,
        areaPath: area,
        pointPositions: positions,
        bestPointIdx: bestIdx,
        yMin: paddedMin,
        yMax: paddedMax,
        yTicks: ticks,
        xLabels: labels,
      };
    }, [sorted, bestRecord, chartWidth]);

  if (sorted.length < 2 || !linePath) return null;

  const textMuted = isDark ? darkColors.textMuted : colors.textMuted;
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const dotColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)';
  const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const yRange = yMax - yMin || 1;

  return (
    <ChartErrorBoundary height={CHART_HEIGHT}>
      <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
        <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>
          All efforts ({records.length})
        </Text>
        <View style={styles.chartWrapper} onLayout={onChartLayout}>
          {chartWidth > 0 ? (
            <Canvas style={{ width: chartWidth, height: CHART_HEIGHT }}>
              {/* Horizontal grid lines */}
              {yTicks.map((tick, i) => {
                const y = CHART_PADDING.top + ((tick - yMin) / yRange) * drawH;
                return (
                  <SkiaLine
                    key={`grid-${i}`}
                    p1={vec(CHART_PADDING.left, y)}
                    p2={vec(chartWidth - CHART_PADDING.right, y)}
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
                  colors={[`${lineColor}25`, `${lineColor}05`]}
                />
              </Path>
              {/* Line */}
              <Path
                path={linePath}
                style="stroke"
                strokeWidth={2}
                color={lineColor}
                strokeCap="round"
                strokeJoin="round"
              />
              {/* Scatter dots */}
              {pointPositions.map((p, i) =>
                i === bestPointIdx ? null : (
                  <Circle key={`dot-${i}`} cx={p.x} cy={p.y} r={3} color={dotColor} />
                )
              )}
              {/* Best record highlight */}
              {bestPointIdx >= 0 && pointPositions[bestPointIdx] && (
                <>
                  <Circle
                    cx={pointPositions[bestPointIdx].x}
                    cy={pointPositions[bestPointIdx].y}
                    r={7}
                    color="#FFB300"
                    opacity={0.3}
                  />
                  <Circle
                    cx={pointPositions[bestPointIdx].x}
                    cy={pointPositions[bestPointIdx].y}
                    r={5}
                    color="#FFB300"
                  />
                  <Circle
                    cx={pointPositions[bestPointIdx].x}
                    cy={pointPositions[bestPointIdx].y}
                    r={2.5}
                    color="#FFFFFF"
                  />
                </>
              )}
            </Canvas>
          ) : null}

          {/* Y-axis labels (time values) — faster at bottom, slower at top */}
          {yTicks.map((tick, i) => {
            const y = CHART_PADDING.top + ((tick - yMin) / yRange) * drawH;
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
                    color: textMuted,
                  },
                ]}
              >
                {formatDuration(tick)}
              </Text>
            );
          })}

          {/* X-axis date labels */}
          <View style={[styles.xAxisRow, { left: CHART_PADDING.left, right: CHART_PADDING.right }]}>
            {xLabels.map((label, i) => (
              <Text key={`x-${i}`} style={[styles.axisLabel, { color: textMuted }]}>
                {label.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
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
