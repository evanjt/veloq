import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CurveChart, useChartColors } from '@/shared/charts';
import { colors, typography, spacing, chartStyles } from '@/theme';
import { usePowerCurve } from '../hooks/usePowerCurve';
import { formatDurationHuman } from '@/shared/format/format';

interface PowerCurveChartProps {
  sport?: string;
  /** Number of days to include (default 365) */
  days?: number;
  height?: number;
  /** Chart color override */
  color?: string;
  /** FTP value for threshold line */
  ftp?: number | null;
}

const FTP_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';
const X_LABELS = ['5s', '1m', '5m', '20m', '1h'];

interface ChartPoint {
  x: number;
  y: number;
  secs: number;
  /** The value in the unit on show: watts, or watts per kilogram. */
  watts: number;
}

/** Whether the body carried a per-kilogram series worth offering. */
function hasPerKg(curve: { watts_per_kg?: number[] } | null | undefined): boolean {
  return (curve?.watts_per_kg ?? []).some((v) => v > 0);
}

/** `260w` or `3.25 W/kg`, the way the header and the axis print a value. */
function formatValue(value: number, perKg: boolean, unit: string): string {
  return perKg ? `${value.toFixed(2)} ${unit}` : `${Math.round(value)}w`;
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
  const chartColors = useChartColors();
  const lineColor = color ?? chartColors.powerCurve;

  const { data: curve, isLoading, error } = usePowerCurve({ sport, days });

  // Per kilogram is the one comparison that survives a change of body weight.
  // Offered only when the body carried the series, and never persisted: it is
  // a way of reading this chart, not a setting.
  const [perKgWanted, setPerKgWanted] = useState(false);
  const perKgAvailable = hasPerKg(curve);
  const perKg = perKgWanted && perKgAvailable;
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

    // Build data points from the curve
    const points: { secs: number; watts: number }[] = [];

    for (let i = 0; i < curve.secs.length; i++) {
      const secs = curve.secs[i];
      const watts = series[i];
      if (watts > 0 && secs > 0) {
        points.push({ secs, watts });
      }
    }

    if (points.length === 0) {
      return {
        chartData: [],
        ftpValue: ftpShown,
        yDomain: [0, 400] as [number, number],
      };
    }

    // Sort by duration
    points.sort((a, b) => a.secs - b.secs);

    // Sample points using logarithmic spacing for smooth curve
    const sampled: typeof points = [];
    const logMin = Math.log10(Math.max(1, points[0].secs));
    const logMax = Math.log10(points[points.length - 1].secs);
    const numSamples = 60;

    for (let i = 0; i < numSamples; i++) {
      const logVal = logMin + (logMax - logMin) * (i / (numSamples - 1));
      const targetSecs = Math.pow(10, logVal);

      // Find closest point
      let closest = points[0];
      let minDiff = Math.abs(points[0].secs - targetSecs);
      for (const p of points) {
        const diff = Math.abs(p.secs - targetSecs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }

      // Avoid duplicates
      if (sampled.length === 0 || sampled[sampled.length - 1].secs !== closest.secs) {
        sampled.push(closest);
      }
    }

    // Convert to chart format (use log of duration for x to spread out short durations)
    const data: ChartPoint[] = sampled.map((p) => ({
      x: Math.log10(p.secs),
      y: p.watts,
      secs: p.secs,
      watts: p.watts,
    }));

    // Calculate Y domain
    const watts = data.map((d) => d.y);
    const minWatts = Math.min(...watts);
    const maxWatts = Math.max(...watts);
    const padding = (maxWatts - minWatts) * 0.1;

    return {
      chartData: data,
      ftpValue: ftpShown,
      yDomain: [Math.max(0, minWatts - padding), maxWatts + padding] as [number, number],
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

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.powerCurve')}</Text>
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, isDark && chartStyles.textDark]}>
            {t('common.loading')}
          </Text>
        </View>
      </View>
    );
  }

  if (error || chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.powerCurve')}</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {t('stats.noPowerData')}
          </Text>
        </View>
      </View>
    );
  }

  // Display data - either selected point or latest
  const displayData = tooltipData || chartData[chartData.length - 1];

  return (
    <View style={[styles.container, { height }]} testID="power-curve-chart">
      {/* Header with values */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.powerCurve')}</Text>
        <View style={styles.valuesRow}>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
              {t('stats.time')}
            </Text>
            <Text testID="power-curve-duration" style={[styles.valueNumber, { color: lineColor }]}>
              {formatDurationHuman(displayData.secs)}
            </Text>
          </View>
          <View style={styles.valueItem}>
            <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
              {t('activity.power')}
            </Text>
            <Text testID="power-curve-watts" style={[styles.valueNumber, { color: lineColor }]}>
              {formatValue(displayData.watts, perKg, unit)}
            </Text>
          </View>
        </View>
      </View>

      {perKgAvailable && (
        <View style={styles.unitToggle}>
          <Pressable
            testID="power-curve-unit-watts"
            accessibilityRole="button"
            accessibilityState={{ selected: !perKg }}
            onPress={() => setPerKgWanted(false)}
            style={[styles.unitPill, !perKg && styles.unitPillActive]}
          >
            <Text
              style={[
                styles.unitText,
                isDark && chartStyles.textDark,
                !perKg && { color: lineColor },
              ]}
            >
              {t('units.watts')}
            </Text>
          </Pressable>
          <Pressable
            testID="power-curve-unit-per-kg"
            accessibilityRole="button"
            accessibilityState={{ selected: perKg }}
            onPress={() => setPerKgWanted(true)}
            style={[styles.unitPill, perKg && styles.unitPillActive]}
          >
            <Text
              style={[
                styles.unitText,
                isDark && chartStyles.textDark,
                perKg && { color: lineColor },
              ]}
            >
              {unit}
            </Text>
          </Pressable>
        </View>
      )}

      <CurveChart
        data={chartData}
        yDomain={yDomain}
        color={lineColor}
        referenceLine={referenceLine}
        xLabels={X_LABELS}
        formatY={formatY}
        topAxisTestID="power-curve-axis-top"
        onSelect={setTooltipData}
        onInteractionChange={handleInteractionChange}
      />

      {/* FTP Legend */}
      {ftpValue && (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: FTP_LINE_COLOR }]} />
          <Text
            testID="power-curve-ftp-legend"
            style={[styles.legendText, isDark && chartStyles.textDark]}
          >
            {perKg
              ? `${t('statsScreen.ftpLabel', { value: formatValue(ftpValue, true, unit) })} ${t('stats.atWeight', { kg: Math.round(curve.weight ?? 0) })}`
              : t('statsScreen.ftpLabel', { value: ftpValue })}
          </Text>
        </View>
      )}
    </View>
  );
});

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
    marginBottom: 1,
  },
  valueNumber: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
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
    gap: 6,
  },
  legendDash: {
    width: spacing.md,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  unitToggle: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  unitPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unitPillActive: {
    backgroundColor: colors.primary + '20',
  },
  unitText: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
