import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, LayoutChangeEvent, StyleSheet } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '@/shared/app';
import { Text } from 'react-native-paper';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { RangeCoverage } from 'veloqrs';
import {
  chartStyles,
  colors,
  typography,
  spacing,
  layout,
  verdictColor,
  colorWithOpacity,
  ink,
  brand,
  darkColors,
} from '@/theme';
import {
  useTrainingScreenData,
  type MonthTotals,
  type PeriodTotals,
} from '@/features/stats/hooks/useEngineStats';
import { EngineReadFailureRetry, ToggleButton } from '@/shared/ui';
import { queryKeys } from '@/shared/query/queryKeys';
import { seasonChange, seasonMonthChange } from '@/features/stats/lib/periodWindows';
import { useWindowCoverage } from '@/shared/native/useRangeCoverage';
import {
  formatLocalDate,
  getIntlLocale,
  longDistanceUnitLabel,
  metersToLongDistance,
} from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { useChartGestures } from '@/shared/charts';

interface SeasonComparisonProps {
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

/** Where the bar pair for a month is centred, in a chart `width` wide. */
function monthCentreX(width: number, monthIndex: number): number {
  const groupWidth = width / 12;
  return groupWidth * monthIndex + groupWidth / 2;
}

export function SeasonComparison({ height = 200 }: SeasonComparisonProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');

  // The two calendar years the chart draws, and no more: the totals come from
  // the engine's own GROUP BY rather than from a parsed year of bodies. The
  // year and month to date are set against the same span of last year, never
  // against a whole one, and all of it is the training screen's one read.
  const {
    windows,
    data: { months, yearCurrent, yearPrevious, monthCurrent, monthPrevious },
    error: readError,
  } = useTrainingScreenData();
  const queryClient = useQueryClient();
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
  const { gesture: panGesture, syncXCoords } = useChartGestures({
    data,
    onSelect: handleSelect,
    onInteractionChange: handleInteractionChange,
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

  // Color constants
  const colorCurrent = colors.primary;
  const colorPrevious = isDark
    ? colorWithOpacity(darkColors.chartPreviousSeason, 0.8)
    : colorWithOpacity(colors.chartPreviousSeason, 0.7);

  // Calculate totals
  const totals = useMemo(() => {
    const currentTotal = metricValue(yearCurrent, metric, isMetric);
    const previousTotal = metricValue(yearPrevious, metric, isMetric);
    const pctChange = percentChange(currentTotal, previousTotal);
    return { currentTotal, previousTotal, pctChange };
  }, [yearCurrent, yearPrevious, metric, isMetric]);

  const metricLabels = {
    hours: { label: t('stats.hours'), unit: 'h' },
    distance: { label: t('activity.distance'), unit: longDistanceUnitLabel(isMetric) },
    tss: { label: t('stats.tss'), unit: '' },
  };

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
    const labelSpace = 20; // space for month labels below bars
    const barAreaHeight = chartHeight - labelSpace;

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
    dotPaint.setColor(Skia.Color(colors.primary));

    for (let idx = 0; idx < 12; idx++) {
      const d = data[idx];
      const groupCenterX = monthCentreX(w, idx);
      const isCurrentMonth = idx === currentMonth;
      const isSelected = idx === selectedMonth;

      // Draw highlight background for current month or selected month
      if (isCurrentMonth || isSelected) {
        const hlColor = isSelected
          ? isDark
            ? colorWithOpacity(ink.white, 0.15)
            : colorWithOpacity(ink.black, 0.08)
          : isDark
            ? colorWithOpacity(ink.white, 0.08)
            : colorWithOpacity(brand.tealLight, 0.08);
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
      const previousHeight = maxValue > 0 ? (d.previous / maxValue) * (barAreaHeight - 10) : 0;
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
      const currentHeight = maxValue > 0 ? (d.current / maxValue) * (barAreaHeight - 10) : 0;
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
        dotPaint.setColor(Skia.Color(colors.primary));
        canvas.drawCircle(groupCenterX, chartHeight - 2, 2, dotPaint);
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [
    data,
    maxValue,
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

  if (readError != null) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.seasonComparison')}
          </Text>
        </View>
        <EngineReadFailureRetry
          error={readError}
          onRetry={() =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.stats.training.all })
          }
          testID="season-comparison-failed"
        />
      </View>
    );
  }

  if (!hasData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.seasonComparison')}
          </Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && chartStyles.textDark]}>
            {notDownloaded ? t('stats.rangeNotDownloaded') : t('stats.noActivityData')}
          </Text>
          {!notDownloaded && (
            <Text style={[styles.emptyHint, isDark && chartStyles.textDark]}>
              {t('stats.completeActivitiesYearComparison')}
            </Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.seasonComparison')}
        </Text>
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
      </View>

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
                  {selectedMonthData.previous}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <View style={styles.tooltipItem}>
                <View style={[styles.legendDot, { backgroundColor: colorCurrent }]} />
                <Text style={[styles.summaryLabel, isDark && chartStyles.textDark]}>
                  {currentYear}
                </Text>
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {selectedMonthData.current}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              {monthChange && (
                <Text
                  style={[styles.tooltipDiff, { color: verdictColor(monthChange.rung, isDark) }]}
                >
                  {monthChange.text}
                </Text>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.summaryItem}>
              <View
                testID="season-summary-dot-previous"
                style={[styles.legendDot, { backgroundColor: colorPrevious }]}
              />
              <Text style={[styles.summaryLabel, isDark && chartStyles.textDark]}>
                {currentYear - 1}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.previousTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <View
                testID="season-summary-dot-current"
                style={[styles.legendDot, { backgroundColor: colorCurrent }]}
              />
              <Text style={[styles.summaryLabel, isDark && chartStyles.textDark]}>
                {currentYear}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.currentTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            {totalChange && (
              <View style={styles.summaryItem}>
                <Text
                  style={[styles.summaryValue, { color: verdictColor(totalChange.rung, isDark) }]}
                >
                  {totalChange.text}
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* Chart - Skia Picture + gesture overlay */}
      <GestureDetector gesture={panGesture}>
        <View style={{ height }} onLayout={onChartLayout}>
          {chartPicture && (
            <Canvas style={{ width: '100%', height }}>
              <Picture picture={chartPicture} />
            </Canvas>
          )}
          {/* Month labels overlay */}
          <View style={styles.monthLabelsRow} pointerEvents="none">
            {monthLabels.map((m, idx) => (
              <Text
                key={idx}
                style={[
                  styles.monthLabel,
                  isDark && chartStyles.textDark,
                  m.isCurrentMonth && styles.currentMonthLabel,
                  m.isCurrentMonth && isDark && { color: darkColors.linkTeal },
                  m.isSelected && styles.selectedMonthLabel,
                ]}
              >
                {m.letter}
              </Text>
            ))}
          </View>
        </View>
      </GestureDetector>

      {notDownloaded && (
        <Text
          testID="season-comparison-partial"
          style={[styles.partial, isDark && chartStyles.textDark]}
        >
          {t('stats.rangePartlyDownloaded')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
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
    backgroundColor: colors.regionTintIdle,
    minHeight: 44,
  },
  summaryDark: {
    backgroundColor: darkColors.regionTintIdle,
  },
  summaryActive: {
    backgroundColor: colors.regionTintActive,
  },
  summaryActiveDark: {
    backgroundColor: darkColors.regionTintActive,
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
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  summaryValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipMonth: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
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
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tooltipDiff: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
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
    color: colors.textSecondary,
    textAlign: 'center',
    flex: 1,
  },
  currentMonthLabel: {
    fontWeight: '700',
    color: colors.linkTeal,
  },
  selectedMonthLabel: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  partial: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
