import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useMetricSystem, useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CurveChart, useChartColors, type PlacedLabel } from '@/shared/charts';
import {
  colors,
  typography,
  spacing,
  layout,
  colorWithOpacity,
  themedStyles,
  type Palette,
} from '@/theme';
import { powerChartSeries } from '../lib/curveChartSeries';
import { usePowerCurve } from '../hooks/usePowerCurve';
import { formatDurationHuman, formatEnergy, formatPower } from '@/shared/format/format';
import { getCurrentLanguage } from '@/i18n';
import { formatWeightRounded } from '@/shared/format/weight';
import { RangeCoverage } from 'veloqrs';
import { BodyNotDownloaded, CardHeader, EmptyState, ErrorState, ToggleButton } from '@/shared/ui';
import { CurveLoadingPlaceholder } from './CurveLoadingPlaceholder';
import { formatDecimal } from '@/shared/format';

interface PowerCurveChartProps {
  sport?: string | undefined;
  /** Number of days to include (default 365) */
  days?: number | undefined;
  height?: number | undefined;
  /** Chart color override */
  color?: string | undefined;
  /** FTP value for threshold line */
  ftp?: number | null | undefined;
}

const FTP_LINE_COLOR = colorWithOpacity(colors.chartGuideLine, 0.6);
const X_TICKS_S = [5, 60, 300, 1200, 3600];

let axisLabels: { language: string; labels: PlacedLabel[] } | null = null;

/**
 * The log duration axis ticks, written by the duration formatter in the
 * locale's units. Kept per language, so the chart's label placement sees the
 * same array on every render until the language changes.
 */
export function powerCurveAxisLabels(): PlacedLabel[] {
  const language = getCurrentLanguage();
  if (!axisLabels || axisLabels.language !== language) {
    axisLabels = {
      language,
      labels: X_TICKS_S.map((secs) => ({
        label: formatDurationHuman(secs),
        value: Math.log10(secs),
      })),
    };
  }
  return axisLabels.labels;
}

interface ChartPoint {
  x: number;
  y: number;
  secs: number;
  /** The value in the unit on show: watts, or watts per kilogram. */
  watts: number;
}

/** Whether the body carried a per-kilogram series worth offering. */
function hasPerKg(curve: { watts_per_kg?: number[] | undefined } | null | undefined): boolean {
  return (curve?.watts_per_kg ?? []).some((v) => v > 0);
}

/**
 * The short names for the fits the server sends today. A type this build has
 * not seen prints as the server named it rather than vanishing.
 */
const MODEL_LABELS: Record<string, string> = {
  MS_2P: '2P',
  MORTON_3P: '3P',
  FFT_CURVES: 'FFT',
  ECP: 'ECP',
};

/** `260 W` or `3.25 W/kg`, the way the header, the axis and the FTP line print a value. */
function formatValue(value: number, perKg: boolean, unit: string): string {
  return perKg ? `${formatDecimal(value, 2)} ${unit}` : formatPower(value);
}

export const PowerCurveChart = React.memo(function PowerCurveChart({
  sport,
  days = 365,
  height = 200,
  color,
  ftp,
}: PowerCurveChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const xLabels = powerCurveAxisLabels();
  const isMetric = useMetricSystem();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const lineColor = color ?? chartColors.powerCurve;

  const {
    data: curve,
    isLoading,
    error,
    coverage,
    bodyStatus,
    retryBody,
    refetch,
  } = usePowerCurve({ sport, days });

  // Per kilogram is the one comparison that survives a change of body weight.
  // Offered only when the body carried the series, and never persisted: it is
  // a way of reading this chart, not a setting.
  const [perKgWanted, setPerKgWanted] = useState(false);
  const perKgAvailable = hasPerKg(curve);
  const perKg = perKgWanted && perKgAvailable;
  const models = curve?.models ?? [];
  const unit = t('units.wattsPerKg');

  // Process curve data for the line chart
  const { chartData, ftpValue, yDomain } = useMemo(() => {
    const series = perKg ? curve?.watts_per_kg : curve?.watts;
    // The FTP line follows the unit: the athlete's watts over the weight the
    // server divided the series by, or nothing when that weight is unknown.
    const ftpShown = ftp == null ? null : perKg ? (curve?.weight ? ftp / curve.weight : null) : ftp;
    if (!curve?.secs || !series || series.length === 0) {
      return {
        chartData: [],
        ftpValue: ftpShown,
        yDomain: [0, 400] as [number, number],
      };
    }

    const plotted = powerChartSeries(curve.secs, series);
    if (!plotted) {
      return {
        chartData: [],
        ftpValue: ftpShown,
        yDomain: [0, 400] as [number, number],
      };
    }

    // Log of duration on x spreads out short durations
    const data: ChartPoint[] = plotted.points.map((p) => ({
      x: Math.log10(p.secs),
      y: p.watts,
      secs: p.secs,
      watts: p.watts,
    }));

    return {
      chartData: data,
      ftpValue: ftpShown,
      yDomain: plotted.yDomain,
    };
  }, [curve, ftp, perKg]);

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const handleInteractionChange = useCallback((active: boolean) => {
    if (!active) setTooltipData(null);
  }, []);
  const formatY = useCallback((value: number) => formatValue(value, perKg, unit), [perKg, unit]);
  const referenceLine = useMemo(
    () => (ftpValue ? { value: ftpValue, color: FTP_LINE_COLOR } : null),
    [ftpValue]
  );

  const awaitingBody = bodyStatus === 'waiting' && chartData.length === 0;

  if (isLoading || awaitingBody) {
    return (
      <View style={[styles.container, { height }]}>
        <CardHeader title={t('stats.powerCurve')} />
        <CurveLoadingPlaceholder height={height} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { height }]}>
        <CardHeader title={t('stats.powerCurve')} />
        <ErrorState
          variant="inline"
          error={error}
          onRetry={() => void refetch()}
          testID="power-curve-failed"
        />
      </View>
    );
  }

  if (chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <CardHeader title={t('stats.powerCurve')} />
        <View style={styles.emptyState}>
          {coverage === RangeCoverage.NotFetched ? (
            <BodyNotDownloaded
              testID="power-curve-not-downloaded"
              style={styles.notDownloaded}
              textStyle={styles.notDownloadedText}
              message={t('stats.rangeNotDownloaded')}
              status={bodyStatus}
              onRetry={retryBody}
            />
          ) : (
            <EmptyState variant="inline" title={t('stats.noPowerData')} />
          )}
        </View>
      </View>
    );
  }

  // Display data - either selected point or latest
  const displayData = tooltipData || chartData[chartData.length - 1];

  return (
    <View style={[styles.container, { height }]} testID="power-curve-chart">
      {/* Header with values */}
      <CardHeader
        title={t('stats.powerCurve')}
        accessory={
          <View style={styles.valuesRow}>
            <View style={styles.valueItem}>
              <Text style={styles.valueLabel}>{t('stats.time')}</Text>
              <Text
                testID="power-curve-duration"
                style={[styles.valueNumber, isDark && styles.textLight]}
              >
                {formatDurationHuman(displayData.secs)}
              </Text>
            </View>
            <View style={styles.valueItem}>
              <Text style={styles.valueLabel}>{t('activity.power')}</Text>
              <Text
                testID="power-curve-watts"
                style={[styles.valueNumber, isDark && styles.textLight]}
              >
                {formatValue(displayData.watts, perKg, unit)}
              </Text>
            </View>
          </View>
        }
      />

      {perKgAvailable ? (
        <View style={styles.unitToggle}>
          <ToggleButton
            testID="power-curve-unit-watts"
            label={t('units.watts')}
            selected={!perKg}
            onPress={() => setPerKgWanted(false)}
          />
          <ToggleButton
            testID="power-curve-unit-per-kg"
            label={unit}
            selected={perKg}
            onPress={() => setPerKgWanted(true)}
          />
        </View>
      ) : null}

      <CurveChart
        data={chartData}
        yDomain={yDomain}
        color={lineColor}
        referenceLine={referenceLine}
        xLabels={xLabels}
        formatY={formatY}
        topAxisTestID="power-curve-axis-top"
        onSelect={setTooltipData}
        onInteractionChange={handleInteractionChange}
      />

      {/*
        The fits the server ran over the whole window. They disagree with each
        other by a quarter of the smallest and none of them is the eFTP the app
        shows, so they are named as fits and no one of them is promoted. They
        stay in watts under the per-kilogram toggle: they are the server's
        parameters, not a reading of the plotted series.
      */}
      {models.length > 0 && (
        <View style={styles.models} testID="power-curve-models">
          {models.map((m) => (
            <Text key={m.type} testID={`power-curve-model-${m.type}`} style={styles.modelText}>
              {`${MODEL_LABELS[m.type] ?? m.type} ${formatPower(m.criticalPower)} ${formatEnergy(m.wPrime)}`}
            </Text>
          ))}
        </View>
      )}

      {/* FTP Legend */}
      {ftpValue ? (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: FTP_LINE_COLOR }]} />
          <Text testID="power-curve-ftp-legend" style={styles.legendText}>
            {perKg
              ? t('statsScreen.ftpLabelAtWeight', {
                  value: formatValue(ftpValue, true, unit),
                  weight: formatWeightRounded(curve.weight ?? 0, isMetric),
                })
              : t('statsScreen.ftpLabel', { value: formatValue(ftpValue, false, unit) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    textLight: { color: colors.textOnDark },
    valuesRow: {
      flexDirection: 'row',
      gap: spacing.md,
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
      fontSize: typography.bodySmall.fontSize,
      fontWeight: '700',
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
      fontSize: typography.bodyCompact.fontSize,
      color: palette.textSecondary,
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
    models: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      marginTop: spacing.xs,
      columnGap: spacing.sm,
    },
    modelText: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
    },
    legendText: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
    },
    unitToggle: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.xs,
      marginBottom: spacing.xs,
    },
  });
