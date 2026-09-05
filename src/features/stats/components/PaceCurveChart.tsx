import React, { useMemo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet, Switch, TouchableOpacity } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import {
  colors,
  darkColors,
  typography,
  spacing,
  layout,
  chartStyles,
  switchTrackOff,
} from '@/theme';
import { CurveChart, useChartColors, type PlacedLabel } from '@/shared/charts';
import { usePaceCurve } from '../hooks/usePaceCurve';
import { useActivities } from '@/features/activity/hooks';
import {
  formatFullDate,
  formatDistance,
  formatLocalDate,
  speedToSecsPerKm,
  formatPaceFromSecsPerKm,
  formatDuration,
} from '@/shared/format/format';

interface PaceCurveChartProps {
  sport?: string;
  days?: number;
  height?: number;
}

const CS_LINE_COLOR = 'rgba(150, 150, 150, 0.6)';

// Standard distance markers for the log x axis
const X_LABELS: PlacedLabel[] = [
  { value: Math.log10(400), label: '400m' },
  { value: Math.log10(1000), label: '1km' },
  { value: Math.log10(5000), label: '5km' },
  { value: Math.log10(10000), label: '10km' },
  { value: Math.log10(21097.5), label: '21km' },
];

interface ChartPoint {
  x: number; // log10(distance) for chart positioning
  y: number; // pace in seconds/km
  distance: number; // actual distance in meters
  time: number; // time in seconds to cover this distance
  paceSecsPerKm: number;
  activityId?: string; // Activity that achieved this best effort
}

export function PaceCurveChart({ sport = 'Run', days = 42, height = 220 }: PaceCurveChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  const isRunning = sport === 'Run';

  // GAP toggle state (only for running)
  const [showGap, setShowGap] = useState(false);

  const {
    data: curve,
    isLoading,
    error,
  } = usePaceCurve({
    sport,
    days,
    gap: isRunning && showGap,
  });

  // Get activities to look up names for activity IDs
  // Fetch a wider range to cover all possible activities in the curve
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - days);
  const { data: activities } = useActivities({
    oldest: formatLocalDate(daysAgo),
  });

  const [tooltipData, setTooltipData] = useState<ChartPoint | null>(null);
  const [persistedTooltip, setPersistedTooltip] = useState<ChartPoint | null>(null);

  const lastPointRef = useRef<ChartPoint | null>(null);

  // Build activity lookup map
  const activityMap = useMemo(() => {
    const map = new Map<string, { name: string; date: string }>();
    if (activities) {
      for (const activity of activities) {
        map.set(activity.id, {
          name: activity.name,
          date: activity.start_date_local,
        });
      }
    }
    return map;
  }, [activities]);

  // Process curve data - use distances directly from API
  const { chartData, criticalSpeedPace, yDomain, xDomain } = useMemo(() => {
    if (!curve?.distances || !curve?.times || curve.distances.length === 0) {
      return {
        chartData: [],
        criticalSpeedPace: null,
        yDomain: [240, 480] as [number, number],
        xDomain: [Math.log10(400), Math.log10(21000)] as [number, number],
      };
    }

    const points: ChartPoint[] = [];

    for (let i = 0; i < curve.distances.length; i++) {
      const distance = curve.distances[i];
      const time = curve.times[i];
      const speed = curve.pace[i];
      const activityId = curve.activity_ids?.[i];

      if (distance > 0 && time > 0 && speed > 0) {
        const paceSecsPerKm = speedToSecsPerKm(speed);

        // Filter to reasonable running paces (2:30-10:00 min/km = 150-600 sec/km)
        if (paceSecsPerKm >= 150 && paceSecsPerKm <= 600 && distance >= 100) {
          points.push({
            x: Math.log10(distance),
            y: paceSecsPerKm,
            distance,
            time,
            paceSecsPerKm,
            activityId,
          });
        }
      }
    }

    if (points.length === 0) {
      return {
        chartData: [],
        criticalSpeedPace: null,
        yDomain: [240, 480] as [number, number],
        xDomain: [Math.log10(400), Math.log10(21000)] as [number, number],
      };
    }

    // Sort by distance
    points.sort((a, b) => a.distance - b.distance);

    // Sample to reduce density while keeping shape
    const sampled: ChartPoint[] = [];
    let lastDist = 0;
    for (const p of points) {
      // Adaptive sampling: more points at shorter distances
      const minGap = p.distance < 1000 ? 30 : p.distance < 5000 ? 100 : 300;
      if (p.distance - lastDist >= minGap) {
        sampled.push(p);
        lastDist = p.distance;
      }
    }

    // Critical speed in seconds/km
    const csSecsPerKm = curve.criticalSpeed ? speedToSecsPerKm(curve.criticalSpeed) : null;

    // Calculate y domain (pace range)
    // Note: For pace, LOWER seconds = FASTER, so we want min at TOP of chart
    const paces = sampled.map((d) => d.y);
    const minPace = Math.min(...paces); // fastest
    const maxPace = Math.max(...paces); // slowest
    const padding = (maxPace - minPace) * 0.1;

    // Calculate x domain (log distance range)
    const minDist = Math.min(...sampled.map((d) => d.distance));
    const maxDist = Math.max(...sampled.map((d) => d.distance));

    return {
      chartData: sampled,
      criticalSpeedPace: csSecsPerKm,
      // Invert y domain: [max, min] puts faster paces (lower values) at TOP
      yDomain: [maxPace + padding, minPace - padding] as [number, number],
      xDomain: [Math.log10(minDist), Math.log10(maxDist)] as [number, number],
    };
  }, [curve]);

  const handleSelect = useCallback((point: ChartPoint) => {
    lastPointRef.current = point;
    setTooltipData(point);
  }, []);

  // The last scrubbed point stays on screen after release, so the reader can
  // let go and still see what they landed on.
  const handleInteractionChange = useCallback((active: boolean) => {
    if (active) {
      setPersistedTooltip(null);
      return;
    }
    if (lastPointRef.current) setPersistedTooltip(lastPointRef.current);
    setTooltipData(null);
  }, []);

  const referenceLine = useMemo(
    () => (criticalSpeedPace ? { value: criticalSpeedPace, color: CS_LINE_COLOR } : null),
    [criticalSpeedPace]
  );

  // Display data - either selected point, persisted point, or latest (longest distance)
  const displayData = tooltipData || persistedTooltip || chartData[chartData.length - 1];

  // Get activity info for the selected point
  const selectedActivity = displayData?.activityId ? activityMap.get(displayData.activityId) : null;

  // Navigate to activity when tapped
  const handleActivityTap = useCallback(() => {
    if (displayData?.activityId) {
      router.push(`/activity/${displayData.activityId}`);
    }
  }, [displayData?.activityId]);

  if (isLoading) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.paceCurve')}</Text>
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
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.paceCurve')}</Text>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {t('stats.noPaceData')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* Header with title and GAP toggle */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>{t('stats.paceCurve')}</Text>
        {/* GAP toggle (running only) */}
        {isRunning && (
          <View style={styles.gapToggle}>
            <Text style={[styles.gapLabel, isDark && chartStyles.textDark]}>{t('stats.gap')}</Text>
            <Switch
              value={showGap}
              onValueChange={setShowGap}
              trackColor={{
                false: isDark ? switchTrackOff.dark : switchTrackOff.light,
                true: colors.primary,
              }}
              thumbColor={
                showGap ? colors.textOnDark : isDark ? darkColors.textSecondary : colors.textOnDark
              }
              style={styles.gapSwitch}
            />
          </View>
        )}
      </View>

      {/* Values row */}
      <View style={styles.valuesRow}>
        <View style={styles.valueItem}>
          <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
            {t('activity.distance')}
          </Text>
          <Text style={[styles.valueNumber, { color: chartColors.paceCurve }]}>
            {formatDistance(displayData.distance, isMetric)}
          </Text>
        </View>
        <View style={styles.valueItem}>
          <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>{t('stats.time')}</Text>
          <Text style={[styles.valueNumber, isDark && styles.textLight]}>
            {formatDuration(displayData.time)}
          </Text>
        </View>
        <View style={styles.valueItem}>
          <Text style={[styles.valueLabel, isDark && chartStyles.textDark]}>
            {t('metrics.pace')}
          </Text>
          <Text style={[styles.valueNumber, { color: chartColors.paceCurve }]}>
            {formatPaceFromSecsPerKm(displayData.paceSecsPerKm)}/km
          </Text>
        </View>
      </View>

      {/* Activity info row - shows which activity achieved this best effort */}
      {selectedActivity && (
        <TouchableOpacity
          onPress={handleActivityTap}
          style={styles.activityRow}
          activeOpacity={0.7}
        >
          <View style={[styles.activityPill, isDark && styles.activityPillDark]}>
            <Text style={styles.activityLabel} numberOfLines={1}>
              {selectedActivity.name} →
            </Text>
          </View>
        </TouchableOpacity>
      )}

      <CurveChart
        data={chartData}
        xDomain={xDomain}
        yDomain={yDomain}
        color={chartColors.paceCurve}
        referenceLine={referenceLine}
        xLabels={X_LABELS}
        formatY={formatPaceFromSecsPerKm}
        crosshairMode="finger"
        onSelect={handleSelect}
        onInteractionChange={handleInteractionChange}
      />

      {/* Model info */}
      <View style={styles.footer}>
        <View style={styles.modelInfo}>
          <Text style={[styles.dateRange, isDark && chartStyles.textDark]}>
            {curve?.days ? `${curve.days} days: ` : ''}
            {curve?.startDate && curve?.endDate
              ? `${formatFullDate(curve.startDate)} - ${formatFullDate(curve.endDate)}`
              : ''}
          </Text>
          {criticalSpeedPace && (
            <Text style={[styles.modelStats, isDark && chartStyles.textDark]}>
              CS {formatPaceFromSecsPerKm(criticalSpeedPace)}/km ({curve?.criticalSpeed?.toFixed(2)}{' '}
              m/s)
              {curve?.dPrime ? `  D' ${curve.dPrime.toFixed(0)}m` : ''}
              {curve?.r2 ? `  R² ${curve.r2.toFixed(4)}` : ''}
            </Text>
          )}
        </View>
      </View>
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
    marginBottom: spacing.xs,
  },
  gapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gapLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  gapSwitch: {
    transform: [{ scale: 0.8 }],
  },
  valuesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xs,
  },
  valueItem: {
    alignItems: 'center',
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
  activityRow: {
    marginBottom: spacing.xs,
    alignItems: 'center',
  },
  activityPill: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingHorizontal: layout.borderRadius,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.3)',
  },
  activityPillDark: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    borderColor: 'rgba(76, 175, 80, 0.4)',
  },
  activityLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.run,
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
  footer: {
    marginTop: spacing.xs,
  },
  modelInfo: {
    alignItems: 'center',
  },
  dateRange: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  modelStats: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
});
