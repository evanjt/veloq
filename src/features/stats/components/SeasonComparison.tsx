import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, LayoutChangeEvent, StyleSheet } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { RangeCoverage } from 'veloqrs';
import {
  chartStyles,
  colors,
  colorWithOpacity,
  darkColors,
  ink,
  layout,
  opacity,
  type Palette,
  spacing,
  themedStyles,
  typography,
  verdictColor,
  themePalette,
} from '@/theme';
import type {
  MonthTotals,
  PeriodTotals,
  TrainingCardsRead,
} from '@/features/stats/hooks/useEngineStats';
import { ErrorState, ToggleButton, CardHeader, EmptyState } from '@/shared/ui';
import { seasonChange, seasonMonthChange } from '@/features/stats/lib/periodWindows';
import { useWindowCoverage } from '@/shared/native/useRangeCoverage';
import {
  formatLocalDate,
  getIntlLocale,
  hoursUnitLabel,
  longDistanceUnitLabel,
  metersToLongDistance,
} from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import {
  ChartSurface,
  lanesSummary,
  niceScale,
  seriesTable,
  useChartColors,
  useChartGestures,
  YAxisLabels,
  type SummarySeries,
} from '@/shared/charts';
import { DENSE_TEXT_SCALE } from '@/shared/ui/DenseText';
import { formatDecimalTrimmed } from '@/shared/format';

interface SeasonComparisonProps {
  /** The card's part of the fitness screen read, which the screen makes once. */
  training: TrainingCardsRead;
  /** Height of the chart */
  height?: number;
}

/**
 * The change from `previous` to `current` as a percentage, or null when there
 * is no previous value to take a percentage of. A zero baseline has no
 * percentage change, and showing one as 0 read as "no change".
 */
function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

/**
 * One year's twelve bars, from the engine's monthly aggregate.
 *
 * A month with no activity is absent from the aggregate rather than zero, so
 * the twelve slots are filled here: the chart draws every month of the year and
 * a missing one is a gap, not a shorter axis.
 */
function monthBars(
  months: MonthTotals[],
  year: number,
  metric: 'hours' | 'distance' | 'tss',
  isMetric: boolean
): number[] {
  const bars = new Array(12).fill(0);
  for (const row of months) {
    if (row.year !== year) continue;
    const value =
      metric === 'hours'
        ? row.duration / 3600
        : metric === 'distance'
          ? metersToLongDistance(row.distance, isMetric)
          : row.tss;
    bars[row.month - 1] = Math.round(value * 10) / 10;
  }
  return bars;
}

/** One period's total in the unit the card prints, rounded as the bars are. */
function metricValue(
  totals: PeriodTotals,
  metric: 'hours' | 'distance' | 'tss',
  isMetric: boolean
): number {
  const value =
    metric === 'hours'
      ? totals.duration / 3600
      : metric === 'distance'
        ? metersToLongDistance(totals.distance, isMetric)
        : totals.tss;
  return Math.round(value * 10) / 10;
}

const BAR_WIDTH = 8;
const BAR_GAP = 2;
const BAR_RADIUS = 4; // spacing.xs
/** The strip under the bars the month letters sit in. */
const MONTH_STRIP = 20;
/** Room kept above the tallest bar for its tick label. */
const BAR_HEADROOM = 10;
const PLOT_PADDING = { top: BAR_HEADROOM, bottom: MONTH_STRIP } as const;
/** Steps the value axis is cut into, so the gutter carries three or four round values. */
const Y_INTERVALS = 2;

/** Where the bar pair for a month is centred, in a chart `width` wide. */
function monthCentreX(width: number, monthIndex: number): number {
  const groupWidth = width / 12;
  return groupWidth * monthIndex + groupWidth / 2;
}

export function SeasonComparison({ training, height = 200 }: SeasonComparisonProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const styles = themedStyles(makeStyles, isDark);
  const isMetric = useMetricSystem();
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');

  // The two calendar years the chart draws, and no more: the totals come from
  // the engine's own GROUP BY rather than from a parsed year of bodies. The
  // year and month to date are set against the same span of last year, never
  // against a whole one, and all of it is the fitness screen's one read.
  const {
    windows,
    data: { months, yearCurrent, yearPrevious, monthCurrent, monthPrevious },
    error: readError,
    retry,
  } = training;
  const { currentYear, currentMonth, firstDay, lastDay } = useMemo(
    () => ({
      currentYear: windows.today.getFullYear(),
      currentMonth: windows.today.getMonth(),
      firstDay: formatLocalDate(windows.seasonFrom),
      lastDay: formatLocalDate(windows.today),
    }),
    [windows]
  );
  const coverage = useWindowCoverage(firstDay, lastDay);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    setMeasuredWidth(event.nativeEvent.layout.width);
  }, []);

  // Show empty state when neither year has an activity in it.
  const hasData = months.length > 0;

  const locale = getIntlLocale();
  const data = useMemo(() => {
    const currentTotals = monthBars(months, currentYear, metric, isMetric);
    const previousTotals = monthBars(months, currentYear - 1, metric, isMetric);

    // Month names follow the app language, the short one for the tooltip and
    // the narrow one under each pair of bars.
    return currentTotals.map((current, idx) => {
      const first = new Date(currentYear, idx, 1);
      return {
        month: first.toLocaleDateString(locale, { month: 'short' }),
        letter: first.toLocaleDateString(locale, { month: 'narrow' }),
        current,
        previous: previousTotals[idx],
      };
    });
  }, [months, currentYear, metric, isMetric, locale]);

  // Each month's bar pair is one scrub stop, centred in its twelfth of the width,
  // so the shared scrub snaps to the month under the finger.
  const handleSelect = useCallback((_month: unknown, idx: number) => setSelectedMonth(idx), []);
  const handleInteractionChange = useCallback((active: boolean) => {
    if (!active) setSelectedMonth(null);
  }, []);
  const metricLabels = {
    hours: { label: t('stats.hours'), unit: hoursUnitLabel() },
    distance: { label: t('activity.distance'), unit: longDistanceUnitLabel(isMetric) },
    tss: { label: t('metrics.load'), unit: '' },
  };

  const unit = metricLabels[metric].unit;
  const describeMonth = useCallback(
    (month: (typeof data)[number]) =>
      [
        month.month,
        `${currentYear - 1} ${formatDecimalTrimmed(month.previous, 1)} ${unit}`.trim(),
        `${currentYear} ${formatDecimalTrimmed(month.current, 1)} ${unit}`.trim(),
      ].join(', '),
    [unit, currentYear]
  );
  // What a screen reader hears and the Show data sheet lists: each year's month totals. A month
  // of this year still to come is a gap, not a month with nothing in it.
  const metricLabel = metricLabels[metric].label;
  const reading = useMemo(() => {
    const title = `${t('stats.seasonComparison')}, ${metricLabel}`;
    const year = (
      name: number,
      pick: (month: (typeof data)[number], idx: number) => number | null
    ) =>
      ({
        name: String(name),
        unit: unit || undefined,
        points: data.map((month, idx) => ({ label: month.month, value: pick(month, idx) })),
        format: (v: number) => `${formatDecimalTrimmed(v, 1)} ${unit}`.trim(),
      }) satisfies SummarySeries;
    const lanes = [
      year(currentYear - 1, (month) => month.previous ?? null),
      year(currentYear, (month, idx) => (idx > currentMonth ? null : month.current)),
    ];
    return {
      summary: lanesSummary(title, lanes, t),
      table: seriesTable(title, t('charts.column.month'), lanes),
    };
  }, [data, unit, metricLabel, currentYear, currentMonth, t]);

  const {
    gesture: panGesture,
    syncXCoords,
    accessibilityProps,
  } = useChartGestures({
    data,
    accessibilityLabel: t('stats.seasonComparison'),
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
    describePoint: describeMonth,
  });
  const monthCentres = useMemo(
    () =>
      measuredWidth > 0 ? Array.from({ length: 12 }, (_, i) => monthCentreX(measuredWidth, i)) : [],
    [measuredWidth]
  );
  useEffect(() => {
    syncXCoords(monthCentres, (x) => x);
  }, [monthCentres, syncXCoords]);

  const maxValue = useMemo(() => {
    return Math.max(...data.flatMap((d) => [d.current, d.previous]));
  }, [data]);
  const chartColors = useChartColors();
  // The bars are scaled to the round top of the axis, so each gridline is the value its label names.
  const yScale = useMemo(() => niceScale([0, maxValue], Y_INTERVALS), [maxValue]);
  const axisMax = yScale.domain[1];

  // Color constants
  const colorCurrent = palette.actionPrimary;
  const colorPrevious = isDark
    ? colorWithOpacity(darkColors.chartPreviousSeason, 0.8)
    : colorWithOpacity(colors.chartPreviousSeason, opacity.pressed);

  // Calculate totals
  const totals = useMemo(() => {
    const currentTotal = metricValue(yearCurrent, metric, isMetric);
    const previousTotal = metricValue(yearPrevious, metric, isMetric);
    const pctChange = percentChange(currentTotal, previousTotal);
    return { currentTotal, previousTotal, pctChange };
  }, [yearCurrent, yearPrevious, metric, isMetric]);

  // Get selected month data for tooltip
  const selectedMonthData = selectedMonth !== null ? data[selectedMonth] : null;
  const selectedMonthDiff =
    selectedMonthData && selectedMonth !== null
      ? seasonMonthChange(selectedMonth, currentMonth, selectedMonthData, {
          current: metricValue(monthCurrent, metric, isMetric),
          previous: metricValue(monthPrevious, metric, isMetric),
        })
      : null;
  const monthChange = selectedMonthDiff !== null ? seasonChange(metric, selectedMonthDiff) : null;
  const totalChange = totals.pctChange !== null ? seasonChange(metric, totals.pctChange) : null;

  // Build the bar chart as a single Skia Picture
  const chartPicture = useMemo(() => {
    const w = measuredWidth;
    if (w === 0 || maxValue === 0) return null;

    const chartHeight = height;
    const barAreaHeight = chartHeight - MONTH_STRIP;
    const barSpan = barAreaHeight - BAR_HEADROOM;

    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, chartHeight));

    const barPaint = Skia.Paint();
    barPaint.setAntiAlias(true);

    const highlightPaint = Skia.Paint();
    highlightPaint.setAntiAlias(true);

    const labelPaint = Skia.Paint();
    labelPaint.setAntiAlias(true);

    const dotPaint = Skia.Paint();
    dotPaint.setAntiAlias(true);
    dotPaint.setColor(Skia.Color(colorCurrent));

    const gridPaint = Skia.Paint();
    gridPaint.setAntiAlias(true);
    gridPaint.setColor(Skia.Color(chartColors.grid));
    gridPaint.setStrokeWidth(StyleSheet.hairlineWidth);
    for (const tick of yScale.ticks) {
      const y = barAreaHeight - (tick / axisMax) * barSpan;
      canvas.drawLine(0, y, w, y, gridPaint);
    }

    for (let idx = 0; idx < 12; idx++) {
      const d = data[idx];
      const groupCenterX = monthCentreX(w, idx);
      const isCurrentMonth = idx === currentMonth;
      const isSelected = idx === selectedMonth;

      // Draw highlight background for current month or selected month
      if (isCurrentMonth || isSelected) {
        const hlColor = isSelected
          ? isDark
            ? colorWithOpacity(ink.white, opacity.tint2)
            : colorWithOpacity(ink.black, opacity.tint1)
          : isDark
            ? colorWithOpacity(ink.white, opacity.tint1)
            : colorWithOpacity(colorCurrent, opacity.tint1);
        highlightPaint.setColor(Skia.Color(hlColor));
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(
              groupCenterX - (BAR_WIDTH + BAR_GAP / 2) - 4,
              0,
              BAR_WIDTH * 2 + BAR_GAP + 8,
              chartHeight
            ),
            layout.borderRadiusSm,
            layout.borderRadiusSm
          ),
          highlightPaint
        );
      }

      // Opacity for non-selected months when a month is selected
      const barOpacity = selectedMonth !== null && !isSelected ? 0.4 : 1.0;

      // Draw previous bar (left)
      const previousHeight = (d.previous / axisMax) * barSpan;
      barPaint.setColor(Skia.Color(colorPrevious));
      barPaint.setAlphaf(barOpacity);
      if (previousHeight > 0) {
        const barX = groupCenterX - BAR_WIDTH - BAR_GAP / 2;
        const barY = barAreaHeight - previousHeight;
        canvas.drawRRect(
          Skia.RRectXY(
            Skia.XYWHRect(barX, barY, BAR_WIDTH, previousHeight),
            BAR_RADIUS,
            BAR_RADIUS
          ),
          barPaint
        );
      }

      // Draw current bar (right)
      const currentHeight = (d.current / axisMax) * barSpan;
      barPaint.setColor(Skia.Color(colorCurrent));
      barPaint.setAlphaf(barOpacity);
      if (currentHeight > 0) {
        const barX = groupCenterX + BAR_GAP / 2;
        const barY = barAreaHeight - currentHeight;
        canvas.drawRRect(
          Skia.RRectXY(Skia.XYWHRect(barX, barY, BAR_WIDTH, currentHeight), BAR_RADIUS, BAR_RADIUS),
          barPaint
        );
      }

      // Draw current month indicator dot (below label area)
      if (isCurrentMonth && !isSelected) {
        dotPaint.setColor(Skia.Color(colorCurrent));
        canvas.drawCircle(groupCenterX, chartHeight - 2, 2, dotPaint);
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [
    data,
    maxValue,
    yScale,
    axisMax,
    chartColors.grid,
    height,
    isDark,
    selectedMonth,
    currentMonth,
    colorCurrent,
    colorPrevious,
    measuredWidth,
  ]);

  // Month labels - kept as native Text for proper font rendering
  const monthLabels = useMemo(() => {
    return data.map((d, idx) => ({
      letter: d.letter,
      isCurrentMonth: idx === currentMonth,
      isSelected: idx === selectedMonth,
    }));
  }, [data, currentMonth, selectedMonth]);

  const notDownloaded = coverage === RangeCoverage.NotFetched;
  // The unit is printed once, on the top label.
  const yTicks = yScale.ticks.map((value, i) => ({
    value,
    label:
      i === yScale.ticks.length - 1
        ? `${formatDecimalTrimmed(value, 1)} ${unit}`.trim()
        : formatDecimalTrimmed(value, 1),
  }));

  if (readError != null) {
    return (
      <View style={styles.container}>
        <CardHeader title={t('stats.seasonComparison')} />
        <ErrorState
          variant="inline"
          error={readError}
          onRetry={retry}
          testID="season-comparison-failed"
        />
      </View>
    );
  }

  if (!hasData) {
    return (
      <View style={styles.container}>
        <CardHeader title={t('stats.seasonComparison')} />
        <View style={[styles.emptyState, { height }]}>
          <EmptyState
            variant="inline"
            title={notDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noActivityData')}
            description={notDownloaded ? undefined : t('stats.completeActivitiesYearComparison')}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <CardHeader
        title={t('stats.seasonComparison')}
        accessory={
          <View style={styles.metricSelector}>
            {(['hours', 'distance', 'tss'] as const).map((m) => (
              <ToggleButton
                key={m}
                label={metricLabels[m].label}
                selected={metric === m}
                onPress={() => setMetric(m)}
              />
            ))}
          </View>
        }
      />

      {/* Summary / Tooltip */}
      <View
        style={[
          styles.summary,
          isDark && styles.summaryDark,
          selectedMonth !== null && styles.summaryActive,
          selectedMonth !== null && isDark && styles.summaryActiveDark,
        ]}
      >
        {selectedMonth !== null && selectedMonthData ? (
          <>
            <Text testID="season-tooltip" style={[styles.tooltipMonth, isDark && styles.textLight]}>
              {selectedMonthData.month}
            </Text>
            <View style={styles.tooltipValues}>
              <View style={styles.tooltipItem}>
                <View style={[styles.legendDot, { backgroundColor: colorPrevious }]} />
                <Text style={[styles.summaryLabel, isDark && chartStyles.textDark]}>
                  {currentYear - 1}
                </Text>
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {formatDecimalTrimmed(selectedMonthData.previous, 1)}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <View style={styles.tooltipItem}>
                <View style={[styles.legendDot, { backgroundColor: colorCurrent }]} />
                <Text style={[styles.summaryLabel, isDark && chartStyles.textDark]}>
                  {currentYear}
                </Text>
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {formatDecimalTrimmed(selectedMonthData.current, 1)}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              {monthChange ? (
                <Text
                  style={[styles.tooltipDiff, { color: verdictColor(monthChange.rung, isDark) }]}
                >
                  {monthChange.text}
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.summaryItem}>
              <View
                testID="season-summary-dot-previous"
                style={[styles.legendDot, { backgroundColor: colorPrevious }]}
              />
              <Text style={styles.summaryLabel}>{currentYear - 1}</Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {formatDecimalTrimmed(totals.previousTotal, 1)}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <View
                testID="season-summary-dot-current"
                style={[styles.legendDot, { backgroundColor: colorCurrent }]}
              />
              <Text style={styles.summaryLabel}>{currentYear}</Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {formatDecimalTrimmed(totals.currentTotal, 1)}
                {metricLabels[metric].unit}
              </Text>
            </View>
            {totalChange ? (
              <View style={styles.summaryItem}>
                <Text
                  style={[styles.summaryValue, { color: verdictColor(totalChange.rung, isDark) }]}
                >
                  {totalChange.text}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Chart - Skia Picture + gesture overlay */}
      <ChartSurface summary={reading.summary} table={reading.table} testID="season-chart-plot">
        <View style={[styles.plotRow, { height }]}>
          <YAxisLabels
            ticks={yTicks}
            domain={yScale.domain}
            padding={PLOT_PADDING}
            testID="season-chart-y-axis"
          />
          <GestureDetector gesture={panGesture}>
            <View
              style={styles.plot}
              onLayout={onChartLayout}
              testID="season-chart-surface"
              {...accessibilityProps}
            >
              {chartPicture ? (
                <Canvas style={{ width: '100%', height }}>
                  <Picture picture={chartPicture} />
                </Canvas>
              ) : null}
              {/* Month labels overlay */}
              <View style={styles.monthLabelsRow} pointerEvents="none">
                {monthLabels.map((m, idx) => (
                  <Text
                    key={idx}
                    testID={`season-month-label-${idx}`}
                    maxFontSizeMultiplier={DENSE_TEXT_SCALE}
                    style={[
                      styles.monthLabel,
                      isDark && chartStyles.textDark,
                      m.isCurrentMonth && styles.currentMonthLabel,
                      m.isCurrentMonth && isDark && { color: darkColors.actionLink },
                      m.isSelected && styles.selectedMonthLabel,
                    ]}
                  >
                    {m.letter}
                  </Text>
                ))}
              </View>
            </View>
          </GestureDetector>
        </View>
      </ChartSurface>

      {notDownloaded ? (
        <Text testID="season-comparison-partial" style={styles.partial}>
          {t('stats.rangePartlyDownloaded')}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {},
    textLight: {
      color: colors.textOnFill,
    },
    metricSelector: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    summary: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      marginBottom: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: layout.borderRadiusSm,
      backgroundColor: colors.stateHover,
      minHeight: 44,
    },
    summaryDark: {
      backgroundColor: darkColors.stateHover,
    },
    summaryActive: {
      backgroundColor: colors.statePressed,
    },
    summaryActiveDark: {
      backgroundColor: darkColors.statePressed,
    },
    summaryItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.xsPlus,
    },
    legendDot: {
      width: spacing.sm,
      height: spacing.sm,
      borderRadius: layout.borderRadiusXs,
    },
    summaryLabel: {
      fontSize: typography.label.fontSize,
      color: palette.textSecondary,
      marginRight: spacing.xs,
    },
    summaryValue: {
      ...typography.bodySmallBold,
      color: colors.textPrimary,
    },
    tooltipMonth: {
      ...typography.bodyBold,
      color: colors.textPrimary,
      minWidth: 40,
    },
    tooltipValues: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    tooltipItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    tooltipValue: {
      ...typography.bodySmallBold,
      color: colors.textPrimary,
    },
    tooltipDiff: {
      ...typography.pillValue,
    },
    plotRow: {
      flexDirection: 'row',
    },
    plot: {
      flex: 1,
    },
    monthLabelsRow: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    monthLabel: {
      fontSize: typography.pillLabel.fontSize,
      color: palette.textSecondary,
      textAlign: 'center',
      flex: 1,
    },
    currentMonthLabel: {
      fontWeight: typography.label.fontWeight,
      color: colors.actionLink,
    },
    selectedMonthLabel: {
      fontWeight: typography.label.fontWeight,
      color: colors.textPrimary,
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    partial: {
      ...typography.caption,
      color: palette.textSecondary,
      marginTop: spacing.sm,
    },
  });
