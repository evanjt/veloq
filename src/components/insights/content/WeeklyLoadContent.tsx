import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, RoundedRect, Line as SkiaLine, vec } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

const CHART_HEIGHT = 120;
const CHART_PADDING = { top: 12, bottom: 28, left: 8, right: 8 };
const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 4;

interface WeeklyLoadContentProps {
  insight: Insight;
}

export const WeeklyLoadContent = React.memo(function WeeklyLoadContent({
  insight,
}: WeeklyLoadContentProps) {
  const { isDark } = useTheme();
  const dataPoints = insight.supportingData?.dataPoints;
  if (!dataPoints || dataPoints.length < 2) return null;

  const thisWeekPoint = dataPoints[0];
  const avgPoint = dataPoints[1];
  const changePoint = dataPoints[2];

  const thisWeekVal = typeof thisWeekPoint.value === 'number' ? thisWeekPoint.value : 0;
  const avgVal = typeof avgPoint.value === 'number' ? avgPoint.value : 0;
  const maxVal = Math.max(thisWeekVal, avgVal, 1);

  const changeStr = changePoint ? String(changePoint.value) : '';
  const isAbove = thisWeekVal > avgVal;
  const barColor = isAbove ? '#FFA726' : '#42A5F5';
  const avgLineColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)';

  const chartData = useMemo(() => {
    const drawW = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
    const drawH = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;

    const barWidth = Math.min(drawW * 0.4, 60);
    const barX = CHART_PADDING.left + (drawW - barWidth) / 2;
    const barHeight = maxVal > 0 ? (thisWeekVal / maxVal) * drawH : 0;
    const barY = CHART_PADDING.top + drawH - barHeight;

    const avgY = CHART_PADDING.top + drawH - (avgVal / maxVal) * drawH;

    return {
      barX,
      barY,
      barWidth,
      barHeight: Math.max(barHeight, 2),
      avgY,
      drawW,
      labelY: CHART_PADDING.top + drawH + 4,
    };
  }, [thisWeekVal, avgVal, maxVal]);

  return (
    <View style={styles.container}>
      <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
        <View style={styles.chartWrapper}>
          <Canvas style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
            <RoundedRect
              x={chartData.barX}
              y={chartData.barY}
              width={chartData.barWidth}
              height={chartData.barHeight}
              r={4}
              color={barColor}
            />
            <SkiaLine
              p1={vec(CHART_PADDING.left + 20, chartData.avgY)}
              p2={vec(CHART_WIDTH - CHART_PADDING.right - 20, chartData.avgY)}
              color={avgLineColor}
              strokeWidth={1.5}
              style="stroke"
            />
          </Canvas>

          <View
            style={[
              styles.barLabelContainer,
              { left: chartData.barX, width: chartData.barWidth, top: chartData.labelY },
            ]}
          >
            <Text style={[styles.barLabelText, isDark && styles.barLabelTextDark]}>This week</Text>
          </View>

          <View
            style={[
              styles.barValueContainer,
              { left: chartData.barX, width: chartData.barWidth, top: chartData.barY - 18 },
            ]}
          >
            <Text style={[styles.barValueText, isDark && styles.barValueTextDark]}>
              {thisWeekVal} {thisWeekPoint.unit ?? 'TSS'}
            </Text>
          </View>

          <View
            style={[
              styles.avgLabelContainer,
              {
                top: chartData.avgY - 8,
                right: CHART_PADDING.right + 4,
              },
            ]}
          >
            <Text style={[styles.avgLabelText, isDark && styles.avgLabelTextDark]}>
              4-wk avg: {avgVal} {avgPoint.unit ?? 'TSS'}
            </Text>
          </View>
        </View>
      </View>

      {changeStr ? (
        <View style={[styles.changeBadge, { backgroundColor: `${barColor}18` }]}>
          <Text style={[styles.changeText, { color: barColor }]}>{changeStr}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    width: '100%',
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  barValueTextDark: {
    color: darkColors.textPrimary,
  },
  avgLabelContainer: {
    position: 'absolute',
  },
  avgLabelText: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  avgLabelTextDark: {
    color: darkColors.textSecondary,
  },
  changeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  changeText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
