import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { RangeCoverage } from 'veloqrs';

import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { useTranslation } from 'react-i18next';
import { Circle, LinearGradient, vec } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { SharedValue, useSharedValue } from 'react-native-reanimated';
import {
  colors,
  darkColors,
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
  CurveArea,
  ChartSurface,
  CurveLine,
  lanesSummary,
  seriesTable,
  useChartColors,
  useChartGestures,
  type SummarySeries,
} from '@/shared/charts';
import type { WellnessData } from '@/types';
import { displayedDay, headerDay } from '../lib/pinnedDay';
import { formatForm, formZoneTextColor, formZoneFromLoads } from '../lib';
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

const CHART_PADDING = { top: 8, bottom: 20 } as const;
const SERIES = {
  fitness: (d: ChartDataPoint) => d.fitness,
  fatigue: (d: ChartDataPoint) => d.fatigue,
};
const xOf = (d: ChartDataPoint) => d.x;

const MARKER_RADIUS = 4;

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
}: FitnessChartProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const styles = themedStyles(makeStyles, isDark);
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
  const yDomain: [number, number] = [0, maxFitness * 1.1];
  const markerChanges = tooltipData ? eftpChangesOn(markers, tooltipData.date) : [];
  const markerIndices = markerIndicesOf(chartData, markers);

  return (
    <ChartErrorBoundary height={height} chartName="Fitness Chart">
      <View style={[styles.container, { height }]}>
        {/* Header with values */}
        <View style={styles.header}>
          <View style={styles.dateContainer}>
            <Text testID="fitness-chart-day" style={[styles.dateText, isDark && styles.textLight]}>
              {header.isToday ? t('time.today') : formatShortDate(header.date)}
            </Text>
            {markerChanges.length > 0 && (
              <Text
                testID="fitness-eftp-change"
                style={[
                  styles.markerText,
                  { color: isDark ? darkColors.chartAccentText : colors.chartAccentText },
                ]}
              >
                {markerChanges.map((c) => formatEftpChange(c, t('units.watts'))).join(', ')}
              </Text>
            )}
          </View>
          <View style={styles.valuesRow}>
            <View style={styles.valueItem}>
              <Text style={styles.valueLabel}>{t('metrics.fitness')}</Text>
              <Text
                testID="fitness-ctl-value"
                style={[
                  styles.valueNumber,
                  { color: isDark ? darkColors.fitnessBlueText : colors.fitnessBlueText },
                ]}
                accessibilityLabel={absentLabel(fitnessText, t)}
              >
                {fitnessText}
              </Text>
            </View>
            <View style={styles.valueItem}>
              <Text style={styles.valueLabel}>{t('metrics.fatigue')}</Text>
              <Text
                testID="fitness-atl-value"
                style={[
                  styles.valueNumber,
                  { color: isDark ? darkColors.chartPurpleText : colors.chartPurpleText },
                ]}
                accessibilityLabel={absentLabel(fatigueText, t)}
              >
                {fatigueText}
              </Text>
            </View>
            <View style={styles.valueItem}>
              <Text style={styles.valueLabel}>{t('metrics.form')}</Text>
              <Text
                testID="fitness-form-value"
                style={[
                  styles.valueNumber,
                  {
                    color: formZone ? formZoneTextColor(formZone, isDark) : themeColors.text,
                  },
                ]}
                accessibilityLabel={absentLabel(formText, t)}
              >
                {formText}
              </Text>
            </View>
            {rampRate != null && (
              <View style={styles.valueItem}>
                <Text style={styles.valueLabel}>{t('fitnessScreen.rampRate')}</Text>
                <View style={styles.rampValue}>
                  <Text
                    testID="fitness-ramp-value"
                    style={[
                      styles.valueNumber,
                      {
                        color:
                          rampRate >= 0
                            ? isDark
                              ? darkColors.fitnessBlueText
                              : colors.fitnessBlueText
                            : isDark
                              ? darkColors.fatiguePurpleText
                              : colors.fatiguePurpleText,
                      },
                    ]}
                  >
                    {formatSigned(rampRate, 1)}
                  </Text>
                  <Text style={styles.valueLabel}>{t('fitnessScreen.perWeek')}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Chart */}
        <ChartSurface summary={reading.summary} table={reading.table} testID="fitness-chart-plot">
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
                grid={5}
              >
                {({ points, bounds }) => {
                  syncBounds(bounds);
                  syncXCoords(points.fitness, (p) => p.x);
                  return (
                    <>
                      {visibleLines.fitness ? (
                        <>
                          <CurveArea points={points.fitness} y0={bounds.bottom}>
                            <LinearGradient
                              start={vec(0, bounds.top)}
                              end={vec(0, bounds.bottom)}
                              colors={[chartColors.fitness + '40', chartColors.fitness + '05']}
                            />
                          </CurveArea>
                          <CurveLine
                            points={points.fitness}
                            color={chartColors.casing}
                            strokeWidth={2.5}
                          />
                          <CurveLine
                            points={points.fitness}
                            color={chartColors.fitness}
                            strokeWidth={1.5}
                          />
                        </>
                      ) : null}
                      {visibleLines.fatigue ? (
                        <>
                          <CurveLine
                            points={points.fatigue}
                            color={chartColors.casing}
                            strokeWidth={2}
                          />
                          <CurveLine
                            points={points.fatigue}
                            color={chartColors.fatigue}
                            strokeWidth={1}
                          />
                        </>
                      ) : null}
                      {markerIndices.map((idx) => (
                        <Circle
                          key={chartData[idx].date}
                          cx={points.fitness[idx].x}
                          cy={bounds.top + MARKER_RADIUS}
                          r={MARKER_RADIUS}
                          color={chartColors.accent}
                        />
                      ))}
                    </>
                  );
                }}
              </ChartCanvas>

              {/* Animated crosshair - runs at native 120Hz using synced point coordinates */}
              <ChartCrosshair style={crosshairStyle} topOffset={8} />

              {/* X-axis labels */}
              <View style={styles.xAxisOverlay} pointerEvents="none">
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}
                >
                  {chartData.length > 0 ? formatShortDate(chartData[0].date) : ''}
                </Text>
                <Text
                  maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                  style={[chartStyles.axisLabel, isDark && chartStyles.axisLabelDark]}
                >
                  {chartData.length > 0
                    ? formatShortDate(chartData[chartData.length - 1].date)
                    : ''}
                </Text>
              </View>
            </View>
          </GestureDetector>
        </ChartSurface>

        {/* Legend: each item is a switch that shows or hides its line */}
        <View style={styles.legend}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={t('fitness.fitnessCTL')}
            accessibilityState={{ checked: visibleLines.fitness }}
            style={pressable([styles.legendItem, !visibleLines.fitness && styles.legendItemHidden])}
            android_ripple={pressRipple}
            onPress={() => toggleLine('fitness')}
            hitSlop={LEGEND_SLOP}
          >
            <View style={[styles.legendDot, { backgroundColor: chartColors.fitness }]} />
            <Text style={[styles.legendText, !visibleLines.fitness && styles.legendTextHidden]}>
              {t('fitness.fitnessCTL')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={t('fitness.fatigueATL')}
            accessibilityState={{ checked: visibleLines.fatigue }}
            style={pressable([styles.legendItem, !visibleLines.fatigue && styles.legendItemHidden])}
            android_ripple={pressRipple}
            onPress={() => toggleLine('fatigue')}
            hitSlop={LEGEND_SLOP}
          >
            <View style={[styles.legendDot, { backgroundColor: chartColors.fatigue }]} />
            <Text style={[styles.legendText, !visibleLines.fatigue && styles.legendTextHidden]}>
              {t('fitness.fatigueATL')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ChartErrorBoundary>
  );
});

// The two toggles sit side by side a gap apart, so the slop lifts only their
// height and each keeps its own width.
const LEGEND_ITEM_HEIGHT = typography.label.lineHeight;
const LEGEND_SLOP = slopToMinTapTarget(LEGEND_ITEM_HEIGHT);

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    placeholder: {
      justifyContent: 'center',
    },
    textLight: {
      color: colors.textOnDark,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
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
      marginTop: spacing.xxs,
    },
    valuesRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    valueItem: {
      alignItems: 'center',
    },
    valueLabel: {
      ...typography.micro,
      color: palette.textSecondary,
      marginBottom: spacing.xxs,
    },
    rampValue: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    valueNumber: {
      fontSize: typography.cardTitle.fontSize,
      fontWeight: '700',
    },
    xAxisOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 4,
      right: 4,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing.md,
      marginTop: spacing.xs,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: LEGEND_ITEM_HEIGHT,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: layout.borderRadiusFull,
      marginRight: spacing.xs,
    },
    legendText: {
      fontSize: typography.label.fontSize,
      lineHeight: LEGEND_ITEM_HEIGHT,
      color: palette.textSecondary,
    },
    legendItemHidden: {
      opacity: opacity.dim,
    },
    legendTextHidden: {
      textDecorationLine: 'line-through',
    },
  });
