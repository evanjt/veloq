import React, { useMemo, useCallback, useState, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, useMetricSystem } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import {
  colors,
  colorWithOpacity,
  layout,
  opacity,
  type Palette,
  spacing,
  stroke,
  themedStyles,
  typography,
} from '@/theme';
import { CurveChart, useChartColors, type PlacedLabel } from '@/shared/charts';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { RangeCoverage } from 'veloqrs';
import { BodyNotDownloaded, ErrorState, Row, Switch, EmptyState } from '@/shared/ui';
import { CurveLoadingPlaceholder } from './CurveLoadingPlaceholder';
import { paceChartSeries } from '../lib/curveChartSeries';
import { usePaceCurve } from '../hooks/usePaceCurve';
import { useActivities } from '@/features/activity';
import {
  formatFullDate,
  formatDistance,
  formatLocalDate,
  speedToSecsPerKm,
  formatPaceFromSecsPerKm,
  paceUnitLabel,
  formatDuration,
} from '@/shared/format/format';
import { tapTo } from '@/shared/app/navigation';
import { formatDecimal } from '@/shared/format';
import { NameText } from '@/shared/ui/NameText';

interface PaceCurveChartProps {
  sport?: string;
  days?: number;
  height?: number;
}

const CS_LINE_COLOR = colorWithOpacity(colors.chartGuideLine, 0.6);

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
  activityId?: string | undefined; // Activity that achieved this best effort
}

/** A scrubbed point, with the plotted curve it was taken from. */
interface HeldPoint {
  point: ChartPoint;
  of: readonly ChartPoint[];
}

export function PaceCurveChart({ sport = 'Run', days = 42, height = 220 }: PaceCurveChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const chartColors = useChartColors();
  const isMetric = useMetricSystem();
  const isRunning = sport === 'Run';
  const formatPaceAxis = useCallback(
    (secsPerKm: number) => formatPaceFromSecsPerKm(secsPerKm, isMetric),
    [isMetric]
  );
  const reading = useMemo(
    () => ({
      title: t('stats.paceCurve'),
      xHeader: t('charts.column.distance'),
      unit: paceUnitLabel(isMetric),
      formatX: (x: number) => formatDistance(10 ** x, isMetric),
      formatValue: (secsPerKm: number) =>
        `${formatPaceFromSecsPerKm(secsPerKm, isMetric)}${paceUnitLabel(isMetric)}`,
      lowerIsBetter: true,
      shape: 'curve' as const,
    }),
    [t, isMetric]
  );

  // GAP toggle state (only for running)
  const [showGap, setShowGap] = useState(false);

  const {
    data: curve,
    isLoading,
    error,
    coverage,
    bodyStatus,
    retryBody,
    refetch,
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

  const [tooltipData, setTooltipData] = useState<HeldPoint | null>(null);
  const [persistedTooltip, setPersistedTooltip] = useState<HeldPoint | null>(null);

  const lastPointRef = useRef<HeldPoint | null>(null);

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

    const series = paceChartSeries(curve, speedToSecsPerKm);
    if (!series) {
      return {
        chartData: [],
        criticalSpeedPace: null,
        yDomain: [240, 480] as [number, number],
        xDomain: [Math.log10(400), Math.log10(21000)] as [number, number],
      };
    }

    const points: ChartPoint[] = series.points.map(({ distance, time, pace, activityId }) => ({
      x: Math.log10(distance),
      y: pace,
      distance,
      time,
      paceSecsPerKm: pace,
      activityId,
    }));

    // Critical speed in seconds/km
    const csSecsPerKm = curve.criticalSpeed ? speedToSecsPerKm(curve.criticalSpeed) : null;

    return {
      chartData: points,
      criticalSpeedPace: csSecsPerKm,
      yDomain: series.yDomain,
      xDomain: series.xDomain,
    };
  }, [curve]);

  const handleSelect = useCallback(
    (point: ChartPoint) => {
      const held = { point, of: chartData };
      lastPointRef.current = held;
      setTooltipData(held);
    },
    [chartData]
  );

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

  // A point scrubbed on another curve, before GAP or the range changed, names
  // a figure no longer drawn, so the header falls back to this curve's longest
  // effort instead.
  const heldOnThisCurve = (held: HeldPoint | null) => (held?.of === chartData ? held.point : null);
  const displayData =
    heldOnThisCurve(tooltipData) ??
    heldOnThisCurve(persistedTooltip) ??
    chartData[chartData.length - 1];

  // Get activity info for the selected point
  const selectedActivity = displayData?.activityId ? activityMap.get(displayData.activityId) : null;

  // Navigate to activity when tapped
  const handleActivityTap = useCallback(() => {
    if (displayData?.activityId) {
      tapTo(`/activity/${displayData.activityId}`);
    }
  }, [displayData]);

  const awaitingBody = bodyStatus === 'waiting' && chartData.length === 0;

  if (isLoading || awaitingBody) {
    return (
      <View style={[styles.container, { height }]}>
        <CurveLoadingPlaceholder height={height} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { height }]}>
        <ErrorState
          variant="inline"
          error={error}
          onRetry={() => void refetch()}
          testID="pace-curve-failed"
        />
      </View>
    );
  }

  if (chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <View style={styles.emptyState}>
          {coverage === RangeCoverage.NotFetched ? (
            <BodyNotDownloaded
              testID="pace-curve-not-downloaded"
              style={styles.notDownloaded}
              textStyle={styles.notDownloadedText}
              message={t('stats.rangeNotDownloaded')}
              status={bodyStatus}
              onRetry={retryBody}
            />
          ) : (
            <EmptyState variant="inline" title={t('stats.noPaceData')} />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {/* The GAP toggle, which only running has; the section names the curve. */}
      {isRunning ? (
        <View style={styles.gapToggle}>
          <Text maxFontSizeMultiplier={DENSE_TEXT_SCALE} style={styles.gapLabel}>
            {t('stats.gap')}
          </Text>
          <Switch
            value={showGap}
            onValueChange={setShowGap}
            accessibilityLabel={t('stats.gradeAdjustedPace')}
          />
        </View>
      ) : null}

      {/* Values row */}
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
            {formatDuration(displayData.time)}
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
            {formatPaceFromSecsPerKm(displayData.paceSecsPerKm, isMetric)}
            {paceUnitLabel(isMetric)}
          </Text>
        </View>
      </View>

      {/* The activity that set the effort the header shows. */}
      {selectedActivity ? (
        <Row
          inset="none"
          behaviour="navigate"
          accessibilityLabel={selectedActivity.name}
          onPress={handleActivityTap}
        >
          <View style={[styles.activityPill, isDark && styles.activityPillDark]}>
            <NameText style={[styles.activityLabel, isDark && styles.textLight]}>
              {selectedActivity.name}
            </NameText>
          </View>
        </Row>
      ) : null}

      <CurveChart
        data={chartData}
        xDomain={xDomain}
        yDomain={yDomain}
        color={chartColors.paceCurve}
        referenceLine={referenceLine}
        xLabels={X_LABELS}
        formatY={formatPaceAxis}
        reading={reading}
        crosshairMode="finger"
        describePoint={(p) =>
          [
            formatDistance(p.distance, isMetric),
            formatDuration(p.time),
            `${formatPaceFromSecsPerKm(p.paceSecsPerKm, isMetric)}${paceUnitLabel(isMetric)}`,
          ].join(', ')
        }
        onSelect={handleSelect}
        onInteractionChange={handleInteractionChange}
      />

      {/* The rule the chart draws, named. The power and swim curves carry the
          same row; without it the dashed line crosses the curve saying nothing,
          and the figure sits in the model line among D' and R². */}
      {criticalSpeedPace ? (
        <View style={styles.legend}>
          <View style={[styles.legendDash, { backgroundColor: CS_LINE_COLOR }]} />
          <Text
            maxFontSizeMultiplier={DENSE_TEXT_SCALE}
            testID="pace-curve-cs-legend"
            style={styles.legendText}
          >
            {t('metrics.cs')} {formatPaceFromSecsPerKm(criticalSpeedPace, isMetric)}
            {paceUnitLabel(isMetric)}
          </Text>
        </View>
      ) : null}

      {/* Model info */}
      <View style={styles.footer}>
        <View style={styles.modelInfo}>
          <Text style={styles.dateRange}>
            {curve?.days ? `${t('time.daysCount', { count: curve.days })}: ` : ''}
            {curve?.startDate && curve?.endDate
              ? `${formatFullDate(curve.startDate)} - ${formatFullDate(curve.endDate)}`
              : ''}
          </Text>
          {criticalSpeedPace ? (
            <Text style={styles.modelStats}>
              {t('metrics.cs')} {formatPaceFromSecsPerKm(criticalSpeedPace, isMetric)}
              {paceUnitLabel(isMetric)} (
              {curve?.criticalSpeed != null ? formatDecimal(curve.criticalSpeed, 2) : ''}{' '}
              {t('units.metresPerSecond')})
              {curve?.dPrime ? `  D' ${formatDecimal(curve.dPrime, 0)} ${t('units.metres')}` : ''}
              {curve?.r2 ? `  R² ${formatDecimal(curve.r2, 4)}` : ''}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    textLight: { color: colors.textOnDark },
    gapToggle: {
      flexDirection: 'row',
      alignSelf: 'flex-end',
      alignItems: 'center',
      gap: spacing.xsPlus,
      marginBottom: spacing.sm,
    },
    gapLabel: {
      ...typography.caption,
      color: palette.textSecondary,
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
      color: palette.textSecondary,
      marginBottom: spacing.xxs,
    },
    valueNumber: {
      ...typography.pillValue,
    },

    activityPill: {
      flexShrink: 1,
      backgroundColor: colorWithOpacity(colors.run, 0.15),
      paddingHorizontal: layout.borderRadius,
      paddingVertical: spacing.xs,
      borderRadius: layout.borderRadius,
      borderWidth: stroke.one,
      borderColor: colorWithOpacity(colors.run, opacity.tint4),
    },
    activityPillDark: {
      backgroundColor: colorWithOpacity(colors.run, 0.2),
      borderColor: colorWithOpacity(colors.run, opacity.dim),
    },
    activityLabel: {
      ...typography.captionBold,
      color: colors.textPrimary,
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
      color: palette.textSecondary,
    },
    footer: {
      marginTop: spacing.xs,
    },
    modelInfo: {
      alignItems: 'center',
    },
    dateRange: {
      ...typography.micro,
      color: palette.textSecondary,
      marginBottom: spacing.xxs,
    },
    modelStats: {
      ...typography.micro,
      color: palette.textSecondary,
    },
  });
