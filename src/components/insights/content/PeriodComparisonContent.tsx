import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, RoundedRect } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import { ChartErrorBoundary } from '@/components/ui';
import type { Insight } from '@/types';

const CHART_HEIGHT = 140;
const CHART_PADDING = { top: 12, bottom: 28, left: 8, right: 8 };
const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 4;

interface PeriodComparisonContentProps {
  insight: Insight;
}

interface WeekBar {
  label: string;
  value: number;
  unit?: string;
  isCurrent: boolean;
}

export const PeriodComparisonContent = React.memo(function PeriodComparisonContent({
  insight,
}: PeriodComparisonContentProps) {
  const { isDark } = useTheme();
  const comparison = insight.supportingData?.comparisonData;
  const dataPoints = insight.supportingData?.dataPoints;

  if (!comparison) return null;

  const currentVal = typeof comparison.current.value === 'number' ? comparison.current.value : 0;
  const previousVal = typeof comparison.previous.value === 'number' ? comparison.previous.value : 0;

  const changeStr = String(comparison.change.value);
  const isPositive = changeStr.startsWith('+');
  const changeColor = isPositive ? colors.success : colors.warning;
  const changeIcon = isPositive ? 'arrow-up' : 'arrow-down';

  const bars = useMemo(
    (): WeekBar[] => [
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
    ],
    [comparison, currentVal, previousVal]
  );

  const maxVal = Math.max(...bars.map((b) => b.value), 1);

  const barChart = useMemo(() => {
    const drawW = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
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
  }, [bars, maxVal]);

  const barColor = isPositive ? colors.success : '#42A5F5';
  const mutedBarColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';

  return (
    <View style={styles.container}>
      {/* Bar chart */}
      <ChartErrorBoundary height={CHART_HEIGHT}>
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          <View style={styles.chartWrapper}>
            <Canvas style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
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

      {/* Change badge */}
      <View style={styles.changeRow}>
        <MaterialCommunityIcons name={changeIcon as never} size={16} color={changeColor} />
        <Text style={[styles.changeText, { color: changeColor }]}>{changeStr}</Text>
      </View>

      {/* Activity counts */}
      {dataPoints && dataPoints.length > 0 ? (
        <View style={styles.countRow}>
          {dataPoints.map((dp, i) => (
            <View key={i} style={[styles.countBox, isDark && styles.countBoxDark]}>
              <Text style={[styles.countValue, isDark && styles.countValueDark]}>
                {String(dp.value)}
              </Text>
              <Text style={[styles.countLabel, isDark && styles.countLabelDark]}>{dp.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartWrapper: {
    position: 'relative',
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
  },
  barLabelContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  barLabelText: {
    fontSize: 11,
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
    fontSize: 12,
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
    fontSize: 15,
    fontWeight: '700',
  },
  countRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  countBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  countBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  countValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  countValueDark: {
    color: darkColors.textPrimary,
  },
  countLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  countLabelDark: {
    color: darkColors.textSecondary,
  },
});
