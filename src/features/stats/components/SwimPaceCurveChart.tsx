import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CurveChart, useChartColors, type PlacedLabel } from '@/shared/charts';
import { colors, typography, spacing, chartStyles, layout, colorWithOpacity } from '@/theme';
import { RangeCoverage } from 'veloqrs';
import { CurveLoadingPlaceholder } from './CurveLoadingPlaceholder';
import { paceChartSeries } from '../lib/curveChartSeries';
import { usePaceCurve } from '../hooks/usePaceCurve';
import {
  formatDistance,
  formatMinSec,
  formatSwimPace,
  paceSecondsForUnit,
  swimPaceUnitLabel,
} from '@/shared/format/format';

interface SwimPaceCurveChartProps {
  /** Number of days to include (default 365) */
  days?: number;
  height?: number;
}

const CSS_LINE_COLOR = colorWithOpacity(colors.chartGuideLine, 0.6);
const X_LABELS: PlacedLabel[] = [
  { label: '100m', value: Math.log10(100) },
  { label: '200m', value: Math.log10(200) },
  { label: '400m', value: Math.log10(400) },
  { label: '800m', value: Math.log10(800) },
  { label: '1.5K', value: Math.log10(1500) },
];

// Format time as mm:ss or h:mm:ss
function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0 || !isFinite(totalSeconds)) return '--:--';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Convert m/s to seconds per 100m
function speedToSecsPer100m(metersPerSecond: number): number {
  if (metersPerSecond <= 0) return 0;
  return 100 / metersPerSecond;
}

interface ChartPoint {
  x: number;
  y: number;
  distance: number;
  time: number;
  paceSecsPer100m: number;
  paceMs: number; // Original m/s for display
}

export function SwimPaceCurveChart({ days = 365, height = 200 }: SwimPaceCurveChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  const formatPaceAxis = useCallback(
    (secsPer100m: number) => formatMinSec(paceSecondsForUnit(secsPer100m, 'swim', isMetric)),
    [isMetric]
  );

  const {
    data: curve,
    isLoading,
    error,
    coverage,
    bodyStatus,
  } = usePaceCurve({ sport: 'Swim', days });

  // Process curve data - use distances directly from API
  const { chartData, cssPace, yDomain } = useMemo(() => {
    if (!curve?.distances || !curve?.times || curve.distances.length === 0) {
      return {
        chartData: [],
        cssPace: null,
        yDomain: [90, 180] as [number, number],
      };
    }

    const series = paceChartSeries(curve, speedToSecsPer100m);
    if (!series) {
      return {
        chartData: [],
        cssPace: null,
        yDomain: [90, 180] as [number, number],
      };
    }

    // Use log scale for x-axis
    const data: ChartPoint[] = series.points.map(({ distance, time, speed, pace }) => ({
      x: Math.log10(distance),
      y: pace,
      distance,
      paceSecsPer100m: pace,
      paceMs: speed,
      time,
    }));

    const cssSecsPer100m = curve?.criticalSpeed ? speedToSecsPer100m(curve.criticalSpeed) : null;

    return {
      chartData: data,
      cssPace: cssSecsPer100m,
      yDomain: series.yDomain,
    };
  }, [curve]);

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const handleInteractionChange = useCallback((active: boolean) => {
    if (!active) setTooltipData(null);
  }, []);
  const referenceLine = useMemo(
    () => (cssPace ? { value: cssPace, color: CSS_LINE_COLOR } : null),
    [cssPace]
  );

  const awaitingBody = bodyStatus === 'waiting' && chartData.length === 0;

  if (isLoading || awaitingBody) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.swimPaceCurve')}</Text>
        <CurveLoadingPlaceholder height={height} />
      </View>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.swimPaceCurve')}</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {coverage === RangeCoverage.NotFetched
              ? t('stats.rangeNotDownloaded')
              : t('stats.noSwimPaceData')}
          </Text>
        </View>
      </View>
    );
  }

  // Display data - either selected point or latest
  const displayData = tooltipData || chartData[chartData.length - 1];

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with values */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.swimPaceCurve')}</Text>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
              {t('activity.distance')}
            </Text>
            <Text style={[styles.valueNumber, isDark && styles.textLight]}>
              {formatDistance(displayData.distance, isMetric)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
              {t('stats.time')}
            </Text>
            <Text style={[styles.valueNumber, isDark && styles.textLight]}>
              {formatTime(displayData.time)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
              {t('metrics.pace')}
            </Text>
            <Text style={[styles.valueNumber, isDark && styles.textLight]}>
              {formatSwimPace(displayData.paceMs, isMetric)}
              {swimPaceUnitLabel(isMetric)}
            </Text>
          </View>
        </View>
      </View>

      <CurveChart
        data={chartData}
        yDomain={yDomain}
        color={chartColors.swimCurve}
        referenceLine={referenceLine}
        xLabels={X_LABELS}
        formatY={formatPaceAxis}
        crosshairMode="finger"
        onSelect={setTooltipData}
        onInteractionChange={handleInteractionChange}
      />

      {/* CSS Legend */}
      {cssPace && (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: CSS_LINE_COLOR }]} />
          <Text style={[styles.legendText, isDark && chartStyles.textDark]}>
            CSS {formatMinSec(paceSecondsForUnit(cssPace, 'swim', isMetric))}
            {swimPaceUnitLabel(isMetric)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: { color: colors.textOnDark },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  valuesRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  valueItem: {
    alignItems: 'flex-end',
  },
  valueLabel: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  valueNumber: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    gap: spacing.xsPlus,
  },
  legendDash: {
    width: spacing.md,
    height: 2,
    borderRadius: layout.borderRadiusFull,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
});
