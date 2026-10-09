import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  opacity,
  layout,
  typography,
  insightToneColor,
} from '@/theme';
import { ChartErrorBoundary } from '@/shared/ui';
import { InsightSeriesChart } from '../InsightSeriesChart';
import type { Insight } from '@/types';

const CHART_HEIGHT = 180;

const formatHrv = (value: number) => `${Math.round(value)} ms`;

interface HrvTrendContentProps {
  insight: Insight;
}

export const HrvTrendContent = React.memo(function HrvTrendContent({
  insight,
}: HrvTrendContentProps) {
  const { isDark } = useTheme();

  const history = insight.supportingData?.history;
  const series = history && 'series' in history ? history.series[0] : undefined;
  const avgPoint = insight.supportingData?.dataPoints?.find((dp) => dp.key === 'hrvAverage');
  const latestPoint = insight.supportingData?.dataPoints?.find((dp) => dp.key === 'hrvLatest');

  const avgValue = typeof avgPoint?.value === 'number' ? avgPoint.value : null;
  const latestValue = typeof latestPoint?.value === 'number' ? latestPoint.value : null;

  const trendColor = insightToneColor(insight.iconTone, isDark);

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
          {avgPoint && avgValue != null && (avgValue !== latestValue || latestValue == null) ? (
            <Text style={[styles.avgText, isDark && styles.avgTextDark]}>
              {avgPoint.label}: {avgValue} ms
            </Text>
          ) : avgPoint && avgValue != null ? (
            <Text style={[styles.avgText, isDark && styles.avgTextDark]}>{avgPoint.label}</Text>
          ) : null}
        </View>
      </View>

      {series && series.points.length >= 2 ? (
        <ChartErrorBoundary height={CHART_HEIGHT}>
          <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
            <InsightSeriesChart
              samples={series.points}
              title={series.label}
              color={trendColor}
              formatValue={formatHrv}
            />
          </View>
        </ChartErrorBoundary>
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
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  hrvValue: {
    fontSize: typography.headlineNumber.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  hrvValueDark: {
    color: darkColors.textPrimary,
  },
  hrvUnit: {
    fontSize: typography.body.fontSize,
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
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  avgTextDark: {
    color: darkColors.textSecondary,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
