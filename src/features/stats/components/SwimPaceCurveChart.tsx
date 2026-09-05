import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { CurveChart, useChartColors } from '@/shared/charts';
import { colors, typography, spacing, chartStyles } from '@/theme';
import { usePaceCurve, paceToMinPer100m } from '../hooks/usePaceCurve';
import { formatDistance } from '@/shared/format/format';

interface SwimPaceCurveChartProps {
  /** Number of days to include (default 365) */
  days?: number;
  height?: number;
}

const CSS_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';
const X_LABELS = ['100m', '200m', '400m', '800m', '1.5K'];

// Format seconds per 100m as m:ss
function formatSecsPer100m(secs: number): string {
  return `${Math.floor(secs / 60)}:${Math.round(secs % 60)
    .toString()
    .padStart(2, '0')}`;
}

// Format pace as min:sec per 100m
function formatPace100m(metersPerSecond: number): string {
  if (metersPerSecond <= 0 || !isFinite(metersPerSecond)) return '--:--';
  const { minutes, seconds } = paceToMinPer100m(metersPerSecond);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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

  const { data: curve, isLoading, error } = usePaceCurve({ sport: 'Swim', days });

  // Process curve data - use distances directly from API
  const { chartData, cssPace, yDomain } = useMemo(() => {
    if (!curve?.distances || !curve?.times || curve.distances.length === 0) {
      return {
        chartData: [],
        cssPace: null,
        yDomain: [90, 180] as [number, number],
      };
    }

    const points: ChartPoint[] = [];

    for (let i = 0; i < curve.distances.length; i++) {
      const distance = curve.distances[i];
      const time = curve.times[i];
      const speed = curve.pace[i];
      if (distance > 0 && time > 0 && speed > 0) {
        const paceSecsPer100m = speedToSecsPer100m(speed);

        // Filter reasonable swim paces (50s to 4min per 100m) and reasonable distances
        if (paceSecsPer100m >= 50 && paceSecsPer100m <= 240 && distance >= 25) {
          points.push({
            x: 0,
            y: 0,
            distance,
            paceSecsPer100m,
            paceMs: speed,
            time,
          });
        }
      }
    }

    if (points.length === 0) {
      return {
        chartData: [],
        cssPace: null,
        yDomain: [90, 180] as [number, number],
      };
    }

    points.sort((a, b) => a.distance - b.distance);

    // Sample for smoother curve
    const sampled: typeof points = [];
    let lastDist = 0;
    for (const p of points) {
      const minGap = p.distance < 200 ? 10 : p.distance < 1000 ? 50 : 100;
      if (p.distance - lastDist >= minGap) {
        sampled.push(p);
        lastDist = p.distance;
      }
    }

    // Use log scale for x-axis
    const data = sampled.map((p) => ({
      ...p,
      x: Math.log10(p.distance),
      y: p.paceSecsPer100m,
    }));

    const cssSecsPer100m = curve.criticalSpeed ? speedToSecsPer100m(curve.criticalSpeed) : null;

    const paces = data.map((d) => d.y);
    const minPace = Math.min(...paces); // fastest
    const maxPace = Math.max(...paces); // slowest
    const padding = (maxPace - minPace) * 0.1;

    return {
      chartData: data,
      cssPace: cssSecsPer100m,
      // Invert y domain: [max, min] puts faster paces (lower values) at TOP
      yDomain: [maxPace + padding, minPace - padding] as [number, number],
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

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.swimPaceCurve')}</Text>
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
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.swimPaceCurve')}</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {t('stats.noSwimPaceData')}
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
            <Text style={[styles.valueNumber, { color: chartColors.swimCurve }]}>
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
            <Text style={[styles.valueNumber, { color: chartColors.swimCurve }]}>
              {formatPace100m(displayData.paceMs)}/100m
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
        formatY={formatSecsPer100m}
        crosshairMode="finger"
        onSelect={setTooltipData}
        onInteractionChange={handleInteractionChange}
      />

      {/* CSS Legend */}
      {cssPace && (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: CSS_LINE_COLOR }]} />
          <Text style={[styles.legendText, isDark && chartStyles.textDark]}>
            CSS {formatSecsPer100m(cssPace)}/100m
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
});
