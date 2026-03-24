import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Path, LinearGradient, vec } from '@shopify/react-native-skia';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

const SPARKLINE_HEIGHT = 60;
const SPARKLINE_WIDTH = 280;

function buildSparklinePath(
  data: number[],
  width: number,
  height: number,
  padding: number
): string {
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const drawH = height - padding * 2;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => ({
    x: i * stepX,
    y: padding + drawH - ((v - min) / range) * drawH,
  }));
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function buildSparklineAreaPath(
  data: number[],
  width: number,
  height: number,
  padding: number
): string {
  const linePath = buildSparklinePath(data, width, height, padding);
  if (!linePath) return '';
  const stepX = width / (data.length - 1);
  const lastX = (data.length - 1) * stepX;
  return `${linePath} L ${lastX} ${height} L 0 ${height} Z`;
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

  const avgValue = typeof avgPoint?.value === 'number' ? avgPoint.value : null;
  const latestValue = typeof latestPoint?.value === 'number' ? latestPoint.value : null;

  // Determine trend color from icon
  const trendColor = insight.iconColor;

  const { linePath, areaPath } = useMemo(() => {
    if (!sparklineData || sparklineData.length < 2) {
      return { linePath: '', areaPath: '' };
    }
    return {
      linePath: buildSparklinePath(sparklineData, SPARKLINE_WIDTH, SPARKLINE_HEIGHT, 4),
      areaPath: buildSparklineAreaPath(sparklineData, SPARKLINE_WIDTH, SPARKLINE_HEIGHT, 4),
    };
  }, [sparklineData]);

  return (
    <View style={styles.container}>
      {/* Prominent HRV value */}
      {latestValue != null ? (
        <View style={[styles.statCard, isDark && styles.statCardDark]}>
          <View style={styles.valueRow}>
            <Text style={[styles.hrvValue, isDark && styles.hrvValueDark]}>{latestValue}</Text>
            <Text style={[styles.hrvUnit, isDark && styles.hrvUnitDark]}>ms</Text>
          </View>
          <View style={styles.trendRow}>
            <MaterialCommunityIcons name={insight.icon as never} size={18} color={trendColor} />
            {avgValue != null ? (
              <Text style={[styles.avgText, isDark && styles.avgTextDark]}>
                7-day avg: {avgValue} ms
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Sparkline chart */}
      {linePath ? (
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          {insight.supportingData?.sparklineLabel ? (
            <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>
              {insight.supportingData.sparklineLabel}
            </Text>
          ) : null}
          <Canvas style={{ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT }}>
            <Path path={areaPath} style="fill">
              <LinearGradient
                start={vec(0, 0)}
                end={vec(0, SPARKLINE_HEIGHT)}
                colors={[`${trendColor}40`, `${trendColor}05`]}
              />
            </Path>
            <Path path={linePath} style="stroke" strokeWidth={2} color={trendColor} />
          </Canvas>
        </View>
      ) : null}
    </View>
  );
});

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
});
