import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native-paper';

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  insightToneColor,
  layout,
  opacity,
  spacing,
  typography,
} from '@/theme';
import { ChartErrorBoundary } from '@/shared/ui';
import { InsightSeriesChart } from '../InsightSeriesChart';
import type { Insight } from '@/types';
import { formatHrv } from '@/shared/format/format';

const CHART_HEIGHT = 180;

interface HrvTrendContentProps {
  insight: Insight;
}

export const HrvTrendContent = React.memo(function HrvTrendContent({
  insight,
}: HrvTrendContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const history = insight.supportingData?.history;
  const series = history && 'series' in history ? history.series[0] : undefined;
  const avgPoint = insight.supportingData?.dataPoints?.find((dp) => dp.key === 'hrvAverage');
  const latestPoint = insight.supportingData?.dataPoints?.find((dp) => dp.key === 'hrvLatest');

  const avgValue = typeof avgPoint?.value === 'number' ? avgPoint.value : null;
  const latestValue = typeof latestPoint?.value === 'number' ? latestPoint.value : null;

  const trendColor = insightToneColor(insight.iconTone, isDark);

  return (
    <View style={styles.container}>
      {/* The average the latest reading, the sheet's figure, is read against */}
      <View style={[styles.statCard, isDark && styles.statCardDark]}>
        <View style={styles.trendRow}>
          <MaterialCommunityIcons
            name={insight.icon as never}
            size={iconSize.sm}
            color={trendColor}
          />
          {avgPoint && avgValue != null && (avgValue !== latestValue || latestValue == null) ? (
            <Text style={[styles.avgText, isDark && styles.avgTextDark]}>
              {avgPoint.label}: {avgValue} {t('units.ms')}
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
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  avgText: {
    ...typography.bodyCompact,
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
