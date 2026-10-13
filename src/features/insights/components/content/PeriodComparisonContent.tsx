import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, opacity, layout, typography, verdictColor } from '@/theme';
import { verdictRung } from '@/shared/format/trend';
import { ChartErrorBoundary } from '@/shared/ui';
import { useChartColors, useMeasuredWidth } from '@/shared/charts';
import type { Insight } from '@/types';
import { InsightHistoryChart } from '../InsightHistoryChart';

const CHART_HEIGHT = 140;
const CHART_PADDING = { top: 12, bottom: 28, left: 8, right: 8 };

interface PeriodComparisonContentProps {
  insight: Insight;
}

interface WeekBar {
  label: string;
  value: number;
  unit?: string | undefined;
  isCurrent: boolean;
}

export const PeriodComparisonContent = React.memo(function PeriodComparisonContent({
  insight,
}: PeriodComparisonContentProps) {
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const { width: chartWidth, onLayout } = useMeasuredWidth();
  const comparison = insight.supportingData?.comparisonData;

  const currentVal = typeof comparison?.current.value === 'number' ? comparison.current.value : 0;
  const previousVal =
    typeof comparison?.previous.value === 'number' ? comparison.previous.value : 0;

  // Hooks must run every render - keep them above the !comparison early return
  // and tolerate a null comparison (empty bars) so the hook order is stable.
  const bars = useMemo(
    (): WeekBar[] =>
      comparison
        ? [
            {
              label: String(comparison.previous.label),
              value: previousVal,
              unit: comparison.previous.unit,
              isCurrent: false,
            },
            {
              label: String(comparison.current.label),
              value: currentVal,
              unit: comparison.current.unit,
              isCurrent: true,
            },
          ]
        : [],
    [comparison, currentVal, previousVal]
  );

  const maxVal = Math.max(...bars.map((b) => b.value), 1);

  const barChart = useMemo(() => {
    if (chartWidth <= 0) return [];
    const drawW = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
    const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
    const barCount = bars.length;
    const totalBarSpace = drawW * 0.7;
    const barWidth = Math.min(totalBarSpace / barCount, 60);
    const totalWidth = barWidth * barCount + spacing.sm * (barCount - 1);
    const startX = CHART_PADDING.left + (drawW - totalWidth) / 2;

    return bars.map((bar, i) => {
      const barHeight = maxVal > 0 ? (bar.value / maxVal) * drawH : 0;
      const x = startX + i * (barWidth + spacing.sm);
      const y = CHART_PADDING.top + drawH - barHeight;

      return {
        x,
        y,
        width: barWidth,
        height: Math.max(barHeight, 2),
        label: bar.label,
        value: bar.value,
        unit: bar.unit,
        isCurrent: bar.isCurrent,
        labelY: CHART_PADDING.top + drawH + 4,
      };
    });
  }, [bars, maxVal, chartWidth]);

  if (!comparison) return null;

  // The generator judged the move by the polarity table. Load has no
  // polarity, so it is the neutral rung either way, and the arrow is its bare
  // direction. Nothing here reads a verdict off the sign of the string.
  const changeStr = String(comparison.change.value);
  const trend = insight.supportingData?.trend;
  const rung = trend ? verdictRung(trend.verdict) : 'neutral';
  const changeColor = verdictColor(rung, isDark);
  const changeIcon =
    trend?.direction === 'up' ? 'arrow-up' : trend?.direction === 'down' ? 'arrow-down' : 'minus';

  const barColor = verdictColor(rung, isDark);
  const history = insight.supportingData?.history;
  const hasHistory = history != null && 'series' in history && history.series[0] != null;
  const mutedBarColor = chartColors.mutedBar;

  return (
    <View style={styles.container}>
      {/* The card's weekly bars in full, or the two weeks it compares when it had too few */}
      {hasHistory ? (
        <InsightHistoryChart history={history} color={barColor} />
      ) : (
        <ChartErrorBoundary height={CHART_HEIGHT}>
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            <View style={styles.chartWrapper} onLayout={onLayout}>
              {chartWidth > 0 && (
                <Canvas style={{ width: chartWidth, height: CHART_HEIGHT }}>
                  {barChart.map((bar, i) => (
                    <RoundedRect
                      key={`bar-${i}`}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      r={4}
                      color={bar.isCurrent ? barColor : mutedBarColor}
                    />
                  ))}
                </Canvas>
              )}

              {/* Bar labels below */}
              {barChart.map((bar, i) => (
                <View
                  key={`label-${i}`}
                  style={[
                    styles.barLabelContainer,
                    { left: bar.x, width: bar.width, top: bar.labelY },
                  ]}
                >
                  <Text style={[styles.barLabelText, isDark && styles.barLabelTextDark]}>
                    {bar.label}
                  </Text>
                </View>
              ))}

              {/* Value labels above bars */}
              {barChart.map((bar, i) => (
                <View
                  key={`value-${i}`}
                  style={[
                    styles.barValueContainer,
                    { left: bar.x, width: bar.width, top: bar.y - 18 },
                  ]}
                >
                  <Text
                    style={[
                      styles.barValueText,
                      isDark && styles.barValueTextDark,
                      bar.isCurrent && { fontWeight: '700' },
                    ]}
                  >
                    {typeof bar.value === 'number' && bar.unit
                      ? `${bar.value} ${bar.unit}`
                      : String(comparison[bar.isCurrent ? 'current' : 'previous'].value)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ChartErrorBoundary>
      )}

      {/* Change badge */}
      <View style={styles.changeRow}>
        <MaterialCommunityIcons name={changeIcon as never} size={16} color={changeColor} />
        <Text style={[styles.changeText, { color: changeColor }]}>{changeStr}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartWrapper: {
    position: 'relative',
    height: CHART_HEIGHT,
  },
  barLabelContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  barLabelText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  barLabelTextDark: {
    color: darkColors.textSecondary,
  },
  barValueContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  barValueText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  barValueTextDark: {
    color: darkColors.textPrimary,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  changeText: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '700',
  },
});
