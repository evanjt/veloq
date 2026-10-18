import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CurveChart, useChartColors, type PlacedLabel } from '@/shared/charts';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { colors, typography, spacing, themedStyles, type Palette } from '@/theme';
import { RangeCoverage } from 'veloqrs';
import { BodyNotDownloaded, EmptyState, ErrorState } from '@/shared/ui';
import { CurveLoadingPlaceholder } from './CurveLoadingPlaceholder';
import { CURVE_PLOT_HEIGHT, paceAxisUnit, paceChartSeries } from '../lib/curveChartSeries';
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
  /** The plot's own height; the values row takes its own row above it. */
  plotHeight?: number;
}

// Pool distances, which stay in metres in every unit setting.
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

export function SwimPaceCurveChart({
  days = 365,
  plotHeight = CURVE_PLOT_HEIGHT,
}: SwimPaceCurveChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  const formatPaceAxis = useCallback(
    (secsPer100m: number) => formatMinSec(paceSecondsForUnit(secsPer100m, 'swim', isMetric)),
    [isMetric]
  );
  const reading = useMemo(
    () => ({
      title: t('stats.swimPaceCurve'),
      xHeader: t('charts.column.distance'),
      unit: swimPaceUnitLabel(isMetric),
      formatX: (x: number) => formatDistance(10 ** x, isMetric),
      formatValue: (secsPer100m: number) =>
        `${formatPaceAxis(secsPer100m)}${swimPaceUnitLabel(isMetric)}`,
      lowerIsBetter: true,
      shape: 'curve' as const,
    }),
    [t, isMetric, formatPaceAxis]
  );

  const {
    data: curve,
    isLoading,
    isPlaceholderData,
    error,
    coverage,
    bodyStatus,
    retryBody,
    refetch,
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
    () =>
      cssPace
        ? {
            value: cssPace,
            label: `${t('metrics.css')} ${formatMinSec(paceSecondsForUnit(cssPace, 'swim', isMetric))}${swimPaceUnitLabel(isMetric)}`,
            testID: 'swim-pace-curve-css-label',
          }
        : null,
    [cssPace, isMetric, t]
  );

  const awaitingBody = bodyStatus === 'waiting' && chartData.length === 0;

  if (isLoading || awaitingBody) {
    return (
      <View style={styles.container}>
        <CurveLoadingPlaceholder plotHeight={plotHeight} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { minHeight: plotHeight }]}>
        <ErrorState
          variant="inline"
          error={error}
          onRetry={() => void refetch()}
          testID="swim-pace-curve-failed"
        />
      </View>
    );
  }

  if (chartData.length === 0) {
    return (
      <View style={[styles.container, { minHeight: plotHeight }]}>
        <View style={styles.emptyState}>
          {coverage === RangeCoverage.NotFetched ? (
            <BodyNotDownloaded
              testID="swim-pace-curve-not-downloaded"
              style={styles.notDownloaded}
              textStyle={styles.notDownloadedText}
              message={t('stats.rangeNotDownloaded')}
              status={bodyStatus}
              onRetry={retryBody}
            />
          ) : (
            <EmptyState variant="inline" title={t('stats.noSwimPaceData')} />
          )}
        </View>
      </View>
    );
  }

  // Display data - either selected point or latest
  const displayData = tooltipData || chartData[chartData.length - 1];

  return (
    <View style={styles.container}>
      {/* The scrubbed point, or the longest effort at rest; the section names the curve. */}
      <View style={styles.valuesRow}>
        <View style={styles.valueItem}>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.valueLabel}>
            {t('activity.distance')}
          </Text>
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.valueNumber, isDark && styles.textLight]}
          >
            {formatDistance(displayData.distance, isMetric)}
          </Text>
        </View>
        <View style={styles.valueItem}>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.valueLabel}>
            {t('stats.time')}
          </Text>
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.valueNumber, isDark && styles.textLight]}
          >
            {formatTime(displayData.time)}
          </Text>
        </View>
        <View style={styles.valueItem}>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.valueLabel}>
            {t('metrics.pace')}
          </Text>
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            style={[styles.valueNumber, isDark && styles.textLight]}
          >
            {formatSwimPace(displayData.paceMs, isMetric)}
            {swimPaceUnitLabel(isMetric)}
          </Text>
        </View>
      </View>

      <CurveChart
        data={chartData}
        yDomain={yDomain}
        color={chartColors.swimCurve}
        referenceLine={referenceLine}
        xLabels={X_LABELS}
        formatY={formatPaceAxis}
        yAxisUnit={paceAxisUnit(swimPaceUnitLabel(isMetric))}
        plotHeight={plotHeight}
        reading={reading}
        crosshairMode="finger"
        describePoint={(p) =>
          [
            formatDistance(p.distance, isMetric),
            formatTime(p.time),
            `${formatSwimPace(p.paceMs, isMetric)}${swimPaceUnitLabel(isMetric)}`,
          ].join(', ')
        }
        onSelect={setTooltipData}
        onInteractionChange={handleInteractionChange}
        held={isPlaceholderData}
      />
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    textLight: { color: colors.textOnFill },
    valuesRow: {
      flexDirection: 'row',
      alignSelf: 'flex-end',
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    valueItem: {
      alignItems: 'flex-end',
    },
    valueLabel: {
      fontSize: typography.pillLabel.fontSize,
      color: palette.textSecondary,
      marginBottom: spacing.xxs,
    },
    valueNumber: {
      ...typography.pillValue,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    notDownloaded: {
      alignItems: 'center',
    },
    notDownloadedText: {
      ...typography.bodyCompact,
      color: palette.textSecondary,
    },
  });
