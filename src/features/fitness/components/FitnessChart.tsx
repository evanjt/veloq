import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';

import { useLargeText } from '@/shared/ui/useLargeText';
import { useTranslation } from 'react-i18next';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import {
  colors,
  typography,
  spacing,
  layout,
  chartStyles,
  opacity,
  slopToMinTapTarget,
  themedStyles,
  type Palette,
} from '@/theme';
import { formFromLoads } from '@/shared/math';
import { sortByDateId } from '@/shared/activity/activityUtils';
import { formatLocalDate, formatShortDate } from '@/shared/format/format';
import { ChartErrorBoundary, EmptyState, pressable, pressRipple } from '@/shared/ui';
import {
  ChartCanvas,
  ChartCrosshair,
  chartStroke,
  CurveArea,
  ChartSurface,
  CurveLine,
  lanesSummary,
  niceScale,
  ScrubDot,
  seriesTable,
  TRIANGLE_SIZE,
  TriangleKey,
  TriangleMark,
  useChartColors,
  useChartGestures,
  YAxisLabels,
  type SummarySeries,
} from '@/shared/charts';
import type { WellnessData } from '@/types';
import { displayedDay, headerDay } from '../lib/pinnedDay';
import { formatForm, formZoneColor, formZoneFromLoads, formZoneLabel } from '../lib';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { eftpChangesOn, formatEftpChange, type EftpChange } from '../lib/eftpChanges';
import { ABSENT, absentLabel } from '@/shared/format/absent';
import { formatSigned } from '@/shared/format';

interface FitnessChartProps {
  data: WellnessData[];
  /** Days the accepted eFTP moved, drawn as a mark on the plot. */
  markers?: EftpChange[];
  height?: number;
  selectedDate?: string | null;
  /** Shared value for instant crosshair sync between charts */
  sharedSelectedIdx?: SharedValue<number>;
  onDateSelect?: (
    date: string | null,
    values: { fitness: number; fatigue: number; form: number } | null
  ) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
  /**
   * Whether wellness was downloaded for the range drawn. `NotFetched` turns the
   * empty state into "not downloaded". Absent, the chart claims nothing.
   */
  coverage?: RangeCoverage | undefined;
  /** The data is the previous range's, kept on screen while the new range is read. */
  held?: boolean;
}

interface ChartDataPoint {
  x: number;
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
  /** Fitness points a week as the wellness row logs it, null when it logs none. */
  rampRate: number | null;
}

// The bottom tick label centres on the floor; the card's date axis runs under its last lane.
const CHART_PADDING = { top: 8, bottom: typography.caption.lineHeight / 2 } as const;
const SERIES = {
  fitness: (d: ChartDataPoint) => d.fitness,
  fatigue: (d: ChartDataPoint) => d.fatigue,
};
const xOf = (d: ChartDataPoint) => d.x;

/** An eFTP mark's centre below the plot's top edge, its ring clear of the edge. */
const MARKER_INSET = TRIANGLE_SIZE / 2 + chartStroke.ring;
/** Steps the load axis is cut into, so the gutter carries three or four round values. */
const Y_INTERVALS = 3;

/** The chart indices of the days that carry a marker, in chart order. */
function markerIndicesOf(chartData: { date: string }[], markers: EftpChange[]): number[] {
  if (markers.length === 0) return [];
  const dates = new Set(markers.map((m) => m.date));
  const indices: number[] = [];
  chartData.forEach((d, idx) => {
    if (dates.has(d.date)) indices.push(idx);
  });
  return indices;
}

export const FitnessChart = React.memo(function FitnessChart({
  data,
  markers = [],
  height = 200,
  selectedDate,
  sharedSelectedIdx,
  onDateSelect,
  onInteractionChange,
  coverage,
  held = false,
}: FitnessChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
  const largeText = useLargeText();
  const asPercent = useFormPreference((state) => state.formAsPercent) === true;
  const chartColors = useChartColors();
  const [tooltipData, setTooltipData] = useState<ChartDataPoint | null>(null);
  const [visibleLines, setVisibleLines] = useState({
    fitness: true,
    fatigue: true,
  });
  const onDateSelectRef = useRef(onDateSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  useEffect(() => {
    onDateSelectRef.current = onDateSelect;
    onInteractionChangeRef.current = onInteractionChange;
  }, [onDateSelect, onInteractionChange]);

  const externalSelectedIdx = useSharedValue(-1);

  const toggleLine = useCallback((line: 'fitness' | 'fatigue') => {
    setVisibleLines((prev) => ({ ...prev, [line]: !prev[line] }));
  }, []);

  // Process data for the chart
  const { chartData, maxFitness } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], maxFitness: 100 };
    }

    const points: ChartDataPoint[] = [];

    // Sort by date
    const sorted = sortByDateId(data);

    let maxF = 0;

    sorted.forEach((day, idx) => {
      const fitness = Math.round(day.ctl ?? 0);
      const fatigue = Math.round(day.atl ?? 0);
      const form = formFromLoads(day.ctl, day.atl);
      maxF = Math.max(maxF, fitness, fatigue);

      points.push({
        x: idx,
        date: day.id,
        fitness,
        fatigue,
        form,
        rampRate: day.rampRate ?? null,
      });
    });

    return {
      chartData: points,
      maxFitness: Math.max(maxF, 50),
    };
  }, [data]);

  // What a screen reader hears and the Show data sheet lists: the lines drawn, day by day.
  const reading = useMemo(() => {
    const title = t('fitnessScreen.fitnessAndFatigue');
    const lane = (key: 'fitness' | 'fatigue', name: string): SummarySeries => ({
      name,
      points: chartData.map((d) => ({
        label: formatShortDate(d.date),
        key: d.date,
        value: d[key],
      })),
      format: (v) => String(Math.round(v)),
    });
    const lanes = [
      ...(visibleLines.fitness ? [lane('fitness', t('metrics.fitness'))] : []),
      ...(visibleLines.fatigue ? [lane('fatigue', t('metrics.fatigue'))] : []),
    ];
    return {
      summary: lanesSummary(title, lanes, t),
      table: seriesTable(title, t('charts.column.date'), lanes),
    };
  }, [chartData, visibleLines, t]);

  const handleSelect = useCallback((point: ChartDataPoint) => {
    setTooltipData(point);
    onDateSelectRef.current?.(point.date, {
      fitness: point.fitness,
      fatigue: point.fatigue,
      form: point.form,
    });
  }, []);

  const handleInteractionChange = useCallback((active: boolean) => {
    onInteractionChangeRef.current?.(active);
    if (!active) {
      setTooltipData(null);
      onDateSelectRef.current?.(null, null);
    }
  }, []);

  const describePoint = useCallback(
    (point: ChartDataPoint) => {
      const form = formatForm(point.form, point.fitness, asPercent);
      return [
        formatShortDate(point.date),
        `${t('metrics.fitness')} ${point.fitness}`,
        `${t('metrics.fatigue')} ${point.fatigue}`,
        form === null
          ? t('systemSurfaces.spoken.noReading', { label: t('metrics.form') })
          : `${t('metrics.form')} ${form}`,
      ].join(', ');
    },
    [t, asPercent]
  );

  const { gesture, isActive, crosshairStyle, syncBounds, syncXCoords, accessibilityProps } =
    useChartGestures<ChartDataPoint>({
      data: chartData,
      accessibilityLabel: t('fitnessScreen.fitnessAndFatigue'),
      onSelect: handleSelect,
      onInteractionChange: handleInteractionChange,
      sharedSelectedIdx,
      externalSelectedIdx,
      describePoint,
    });

  // Sync with external selectedDate (from other chart)
  React.useEffect(() => {
    if (selectedDate && chartData.length > 0 && !isActive) {
      const idx = chartData.findIndex((d) => d.date === selectedDate);
      // A pinned day with no row has nothing to show, which is not the last
      // day selected or the newest one.
      setTooltipData(idx >= 0 ? chartData[idx] : null);
      externalSelectedIdx.value = idx;
    } else if (!selectedDate && !isActive) {
      setTooltipData(null);
      externalSelectedIdx.value = -1;
    }
  }, [selectedDate, chartData, isActive, externalSelectedIdx]);

  const newest = chartData[chartData.length - 1];
  if (!newest) {
    return (
      <View style={[styles.placeholder, { height }]}>
        {coverage === RangeCoverage.NotFetched ? (
          <EmptyState
            variant="inline"
            testID="fitness-chart-not-downloaded"
            title={t('stats.rangeNotDownloaded')}
          />
        ) : (
          <EmptyState
            variant="inline"
            title={t('fitness.noData')}
            description={t('fitness.noDataCause')}
          />
        )}
      </View>
    );
  }

  // Get current (latest) values
  const header = headerDay({
    selectedDate,
    isActive,
    selectedRowDate: tooltipData?.date,
    newestDate: newest.date,
    today: formatLocalDate(new Date()),
  });
  const displayData = displayedDay({
    selectedDate,
    isActive,
    selected: tooltipData,
    newest,
  });
  const formZone = displayData
    ? formZoneFromLoads(displayData.fitness, displayData.fatigue, asPercent)
    : null;
  const formText =
    (displayData ? formatForm(displayData.form, displayData.fitness, asPercent) : null) ?? ABSENT;
  const fitnessText = displayData ? String(Math.round(displayData.fitness)) : ABSENT;
  const fatigueText = displayData ? String(Math.round(displayData.fatigue)) : ABSENT;
  const rampRate = displayData?.rampRate ?? null;
  const yScale = niceScale([0, maxFitness * 1.1], Y_INTERVALS);
  const yDomain = yScale.domain;
  const yTicks = yScale.ticks.map((value) => ({ value, label: String(value) }));
  const markerChanges = tooltipData ? eftpChangesOn(markers, tooltipData.date) : [];
  const markerIndices = markerIndicesOf(chartData, markers);
  // The day the scrub, a step or the sibling chart pinned, which each line marks with a dot.
  const scrubIndex = tooltipData ? chartData.indexOf(tooltipData) : -1;

  return (
    <ChartErrorBoundary height={height} chartName="Fitness Chart">
      <View style={[styles.container, { height }]}>
        {/* Header with values */}
        <View style={[styles.header, largeText && styles.headerStacked]}>
          <View style={styles.dateContainer}>
            <Text testID="fitness-chart-day" style={[styles.dateText, isDark && styles.textLight]}>
              {header.isToday ? t('time.today') : formatShortDate(header.date)}
            </Text>
            {markerChanges.length > 0 && (
              <View style={[styles.keyedLabel, styles.markerRow]}>
                <View style={styles.markKey}>
                  <TriangleKey color={chartColors.ftp} />
                </View>
                <Text testID="fitness-eftp-change" style={styles.markerText}>
                  {markerChanges.map((c) => formatEftpChange(c, t('units.watts'))).join(', ')}
                </Text>
              </View>
            )}
          </View>
          <View style={[styles.valuesRow, largeText && styles.valuesWrapped]}>
            {/* Each line's readout is its legend entry and the switch that shows or hides it. */}
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={t('fitness.fitnessCTL')}
              accessibilityState={{ checked: visibleLines.fitness }}
              style={pressable([styles.readoutSwitch, !visibleLines.fitness && styles.lineHidden])}
              android_ripple={pressRipple}
              onPress={() => toggleLine('fitness')}
              hitSlop={READOUT_SLOP}
            >
              <View style={styles.keyedLabel}>
                <View
                  testID="fitness-ctl-key"
                  style={[styles.keyDot, { backgroundColor: chartColors.fitness }]}
                />
                <Text style={[styles.valueLabel, !visibleLines.fitness && styles.labelHidden]}>
                  {t('metrics.fitness')}
                </Text>
              </View>
              <Text
                testID="fitness-ctl-value"
                style={styles.valueNumber}
                accessibilityLabel={absentLabel(fitnessText, t)}
              >
                {fitnessText}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel={t('fitness.fatigueATL')}
              accessibilityState={{ checked: visibleLines.fatigue }}
              style={pressable([styles.readoutSwitch, !visibleLines.fatigue && styles.lineHidden])}
              android_ripple={pressRipple}
              onPress={() => toggleLine('fatigue')}
              hitSlop={READOUT_SLOP}
            >
              <View style={styles.keyedLabel}>
                <View
                  testID="fitness-atl-key"
                  style={[styles.keyDot, { backgroundColor: chartColors.fatigue }]}
                />
                <Text style={[styles.valueLabel, !visibleLines.fatigue && styles.labelHidden]}>
                  {t('metrics.fatigue')}
                </Text>
              </View>
              <Text
                testID="fitness-atl-value"
                style={styles.valueNumber}
                accessibilityLabel={absentLabel(fatigueText, t)}
              >
                {fatigueText}
              </Text>
            </Pressable>
            <View style={styles.valueItem}>
              <View style={styles.keyedLabel}>
                {formZone ? (
                  <View
                    testID="fitness-form-key"
                    style={[styles.keyDot, { backgroundColor: formZoneColor(formZone, isDark) }]}
                  />
                ) : null}
                <Text style={styles.valueLabel}>{t('metrics.form')}</Text>
              </View>
              <View style={styles.inlineValue}>
                <Text
                  testID="fitness-form-value"
                  style={styles.valueNumber}
                  accessibilityLabel={absentLabel(formText, t)}
                >
                  {formText}
                </Text>
                {formZone ? (
                  <Text testID="fitness-form-zone" style={[styles.unitText, styles.inlineCaption]}>
                    {formZoneLabel(formZone)}
                  </Text>
                ) : null}
              </View>
            </View>
            {rampRate != null && (
              <View style={styles.valueItem}>
                <Text style={styles.valueLabel}>{t('fitnessScreen.rampRate')}</Text>
                <View style={styles.inlineValue}>
                  <Text testID="fitness-ramp-value" style={styles.valueNumber}>
                    {formatSigned(rampRate, 1)}
                  </Text>
                  <Text style={styles.unitText}>{t('fitnessScreen.perWeek')}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Chart */}
        <ChartSurface
          summary={reading.summary}
          table={reading.table}
          held={held}
          testID="fitness-chart-plot"
        >
          <View style={styles.plotRow}>
            <YAxisLabels
              ticks={yTicks}
              domain={yDomain}
              padding={CHART_PADDING}
              testID="fitness-chart-y-axis"
            />
            <GestureDetector gesture={gesture}>
              <View
                style={chartStyles.chartWrapper}
                testID="fitness-chart-surface"
                {...accessibilityProps}
              >
                <ChartCanvas
                  data={chartData}
                  x={xOf}
                  series={SERIES}
                  yDomain={yDomain}
                  padding={CHART_PADDING}
                  gridValues={yScale.ticks}
                >
                  {({ points, bounds }) => {
                    syncBounds(bounds);
                    syncXCoords(points.fitness, (p) => p.x);
                    return (
                      <>
                        {visibleLines.fitness ? (
                          <>
                            <CurveArea
                              points={points.fitness}
                              yDomain={yDomain}
                              y0={bounds.bottom}
                              color={chartColors.fitness}
                              isDark={isDark}
                            />
                            <CurveLine
                              points={points.fitness}
                              color={chartColors.casing}
                              strokeWidth={chartStroke.casing}
                            />
                            <CurveLine points={points.fitness} color={chartColors.fitness} />
                          </>
                        ) : null}
                        {visibleLines.fatigue ? (
                          <>
                            <CurveLine
                              points={points.fatigue}
                              color={chartColors.casing}
                              strokeWidth={chartStroke.casing}
                            />
                            <CurveLine points={points.fatigue} color={chartColors.fatigue} />
                          </>
                        ) : null}
                        {markerIndices.map((idx) => (
                          <TriangleMark
                            key={chartData[idx].date}
                            x={points.fitness[idx].x}
                            y={bounds.top + MARKER_INSET}
                            color={chartColors.ftp}
                          />
                        ))}
                        {visibleLines.fitness ? (
                          <ScrubDot at={points.fitness[scrubIndex]} color={chartColors.fitness} />
                        ) : null}
                        {visibleLines.fatigue ? (
                          <ScrubDot at={points.fatigue[scrubIndex]} color={chartColors.fatigue} />
                        ) : null}
                      </>
                    );
                  }}
                </ChartCanvas>

                {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
                <ChartCrosshair style={crosshairStyle} topOffset={8} />
              </View>
            </GestureDetector>
          </View>
        </ChartSurface>

        {/* The legend names only what the readout cannot: the eFTP mark. */}
        {markerIndices.length > 0 ? (
          <View style={styles.legend} testID="fitness-chart-legend">
            <View style={styles.keyedLabel} testID="fitness-legend-eftp">
              <View style={styles.markKey}>
                <TriangleKey color={chartColors.ftp} />
              </View>
              <Text style={styles.legendText}>{t('fitness.eftpChanged')}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ChartErrorBoundary>
  );
});

// The two readout switches sit side by side a gap apart, so the slop lifts only
// their height, a label line over a value line, and each keeps its own width.
const READOUT_ITEM_HEIGHT = typography.caption.lineHeight + typography.metricValue.lineHeight;
const READOUT_SLOP = slopToMinTapTarget(READOUT_ITEM_HEIGHT);

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    placeholder: {
      justifyContent: 'center',
    },
    textLight: {
      color: colors.textOnFill,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    // Past the dense text size the day sits over the readout rather than beside it.
    headerStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: spacing.xs,
    },
    dateContainer: {
      flex: 1,
    },
    dateText: {
      ...typography.bodySmallBold,
      color: colors.textPrimary,
    },
    markerText: {
      ...typography.caption,
      color: palette.textPrimary,
    },
    // A label keyed to its series by a dot in the series colour, never by its own colour.
    keyedLabel: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    markerRow: {
      marginTop: spacing.xxs,
    },
    keyDot: {
      width: spacing.xsPlus,
      height: spacing.xsPlus,
      borderRadius: layout.borderRadiusFull,
      marginRight: spacing.xs,
    },
    valuesRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    valuesWrapped: {
      flexWrap: 'wrap',
      rowGap: spacing.xs,
    },
    markKey: {
      marginRight: spacing.xs,
    },
    valueItem: {
      alignItems: 'center',
    },
    readoutSwitch: {
      alignItems: 'center',
      minHeight: READOUT_ITEM_HEIGHT,
    },
    valueLabel: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    unitText: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    // A number with its unit or its zone name beside it on one baseline.
    inlineValue: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    inlineCaption: {
      marginLeft: spacing.xxs,
    },
    // A readout that changes on every scrub step, so each digit keeps one width.
    valueNumber: {
      ...typography.metricValue,
      color: palette.textPrimary,
    },
    plotRow: {
      flex: 1,
      flexDirection: 'row',
    },
    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    legendText: {
      ...typography.caption,
      color: palette.textSecondary,
    },
    lineHidden: {
      opacity: opacity.dim,
    },
    labelHidden: {
      textDecorationLine: 'line-through',
    },
  });
