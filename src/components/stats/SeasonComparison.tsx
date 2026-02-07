import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  LayoutChangeEvent,
  findNodeHandle,
  UIManager,
} from 'react-native';
import { useTheme } from '@/hooks';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing, layout } from '@/theme/spacing';
import type { Activity } from '@/types';

interface SeasonComparisonProps {
  /** Height of the chart */
  height?: number;
  /** Activities from current year */
  currentYearActivities?: Activity[];
  /** Activities from previous year */
  previousYearActivities?: Activity[];
}

interface MonthData {
  month: string;
  current: number;
  previous: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Aggregate activities by month
function aggregateByMonth(
  activities: Activity[] | undefined,
  metric: 'hours' | 'distance' | 'tss'
): number[] {
  const monthlyTotals = new Array(12).fill(0);

  if (!activities) return monthlyTotals;

  for (const activity of activities) {
    const date = new Date(activity.start_date_local);
    const month = date.getMonth();

    switch (metric) {
      case 'hours':
        monthlyTotals[month] += (activity.moving_time || 0) / 3600;
        break;
      case 'distance':
        monthlyTotals[month] += (activity.distance || 0) / 1000;
        break;
      case 'tss':
        monthlyTotals[month] += activity.icu_training_load || 0;
        break;
    }
  }

  return monthlyTotals.map((v) => Math.round(v * 10) / 10);
}

const BAR_WIDTH = 8;
const BAR_GAP = 2;
const BAR_RADIUS = 4; // spacing.xs

export function SeasonComparison({
  height = 200,
  currentYearActivities,
  previousYearActivities,
}: SeasonComparisonProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [metric, setMetric] = useState<'hours' | 'distance' | 'tss'>('hours');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const chartWidth = useRef(0);
  const chartPageX = useRef(0);
  const chartRef = useRef<View>(null);

  // Handle chart layout to get width and absolute position for touch calculations
  const onChartLayout = useCallback((event: LayoutChangeEvent) => {
    chartWidth.current = event.nativeEvent.layout.width;
    // Measure absolute position after layout
    if (chartRef.current) {
      const nodeHandle = findNodeHandle(chartRef.current);
      if (nodeHandle) {
        UIManager.measure(nodeHandle, (_x, _y, _width, _height, pageX) => {
          chartPageX.current = pageX;
        });
      }
    }
  }, []);

  // Calculate month index from x position relative to chart
  const getMonthFromX = useCallback((x: number) => {
    if (chartWidth.current === 0) return 0;
    const monthIndex = Math.floor((x / chartWidth.current) * 12);
    return Math.max(0, Math.min(11, monthIndex));
  }, []);

  // Pan responder for scrubbing
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          const relativeX = evt.nativeEvent.pageX - chartPageX.current;
          const monthIndex = getMonthFromX(relativeX);
          setSelectedMonth(monthIndex);
        },
        onPanResponderMove: (evt) => {
          const relativeX = evt.nativeEvent.pageX - chartPageX.current;
          const monthIndex = getMonthFromX(relativeX);
          setSelectedMonth(monthIndex);
        },
        onPanResponderRelease: () => {
          setSelectedMonth(null);
        },
        onPanResponderTerminate: () => {
          setSelectedMonth(null);
        },
      }),
    [getMonthFromX]
  );

  // Show empty state if no activities
  const hasData =
    (currentYearActivities && currentYearActivities.length > 0) ||
    (previousYearActivities && previousYearActivities.length > 0);

  const data = useMemo(() => {
    const currentTotals = aggregateByMonth(currentYearActivities, metric);
    const previousTotals = aggregateByMonth(previousYearActivities, metric);

    return MONTHS.map((month, idx) => ({
      month,
      current: currentTotals[idx],
      previous: previousTotals[idx],
    }));
  }, [currentYearActivities, previousYearActivities, metric]);

  if (!hasData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('stats.seasonComparison')}
          </Text>
        </View>
        <View style={[styles.emptyState, { height }]}>
          <Text style={[styles.emptyText, isDark && styles.textDark]}>
            {t('stats.noActivityData')}
          </Text>
          <Text style={[styles.emptyHint, isDark && styles.textDark]}>
            {t('stats.completeActivitiesYearComparison')}
          </Text>
        </View>
      </View>
    );
  }

  const maxValue = useMemo(() => {
    return Math.max(...data.flatMap((d) => [d.current, d.previous]));
  }, [data]);

  const now = new Date();

  // Color constants
  const colorCurrent = colors.primary;
  const colorPrevious = isDark ? 'rgba(100, 149, 237, 0.8)' : 'rgba(70, 130, 220, 0.7)';

  // Calculate totals
  const totals = useMemo(() => {
    const currentTotal = Math.round(data.reduce((sum, d) => sum + d.current, 0) * 10) / 10;
    const previousTotal = Math.round(data.reduce((sum, d) => sum + d.previous, 0) * 10) / 10;
    const diff = Math.round((currentTotal - previousTotal) * 10) / 10;
    const pctChange = previousTotal > 0 ? ((diff / previousTotal) * 100).toFixed(0) : 0;
    return { currentTotal, previousTotal, diff, pctChange };
  }, [data]);

  const metricLabels = {
    hours: { label: t('stats.hours'), unit: 'h' },
    distance: { label: t('activity.distance'), unit: 'km' },
    tss: { label: t('stats.tss'), unit: '' },
  };

  // Current month for highlighting
  const currentMonth = now.getMonth();

  // Get selected month data for tooltip
  const selectedMonthData = selectedMonth !== null ? data[selectedMonth] : null;
  const selectedMonthDiff =
    selectedMonthData && selectedMonthData.previous > 0
      ? ((selectedMonthData.current - selectedMonthData.previous) / selectedMonthData.previous) *
        100
      : 0;

  // Build the bar chart as a single Skia Picture
  const chartPicture = useMemo(() => {
    const w = chartWidth.current;
    if (w === 0 || maxValue === 0) return null;

    const chartHeight = height;
    const labelSpace = 20; // space for month labels below bars
    const barAreaHeight = chartHeight - labelSpace;
    const groupWidth = w / 12;

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
      const groupCenterX = groupWidth * idx + groupWidth / 2;
      const isCurrentMonth = idx === currentMonth;
      const isSelected = idx === selectedMonth;

      // Draw highlight background for current month or selected month
      if (isCurrentMonth || isSelected) {
        const hlColor = isSelected
          ? isDark
            ? 'rgba(255, 255, 255, 0.15)'
            : 'rgba(0, 0, 0, 0.08)'
          : isDark
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(252, 76, 2, 0.08)';
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

      // Draw current bar
      const currentHeight = maxValue > 0 ? (d.current / maxValue) * (barAreaHeight - 10) : 0;
      barPaint.setColor(Skia.Color(colorCurrent));
      barPaint.setAlphaf(barOpacity);
      if (currentHeight > 0) {
        const barX = groupCenterX - BAR_WIDTH - BAR_GAP / 2;
        const barY = barAreaHeight - currentHeight;
        canvas.drawRRect(
          Skia.RRectXY(Skia.XYWHRect(barX, barY, BAR_WIDTH, currentHeight), BAR_RADIUS, BAR_RADIUS),
          barPaint
        );
      }

      // Draw previous bar
      const previousHeight = maxValue > 0 ? (d.previous / maxValue) * (barAreaHeight - 10) : 0;
      barPaint.setColor(Skia.Color(colorPrevious));
      barPaint.setAlphaf(barOpacity);
      if (previousHeight > 0) {
        const barX = groupCenterX + BAR_GAP / 2;
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

      // Draw current month indicator dot (below label area)
      if (isCurrentMonth && !isSelected) {
        dotPaint.setColor(Skia.Color(colors.primary));
        canvas.drawCircle(groupCenterX, chartHeight - 2, 2, dotPaint);
      }
    }

    return recorder.finishRecordingAsPicture();
  }, [data, maxValue, height, isDark, selectedMonth, currentMonth, colorCurrent, colorPrevious]);

  // Month labels — kept as native Text for proper font rendering
  const monthLabels = useMemo(() => {
    return data.map((d, idx) => ({
      letter: d.month.charAt(0),
      isCurrentMonth: idx === currentMonth,
      isSelected: idx === selectedMonth,
    }));
  }, [data, currentMonth, selectedMonth]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, isDark && styles.textLight]}>
          {t('stats.seasonComparison')}
        </Text>
        <View style={styles.metricSelector}>
          {(['hours', 'distance', 'tss'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setMetric(m)}
              style={[styles.metricButton, metric === m && styles.metricButtonActive]}
            >
              <Text
                style={[
                  styles.metricButtonText,
                  isDark && styles.textDark,
                  metric === m && styles.metricButtonTextActive,
                ]}
              >
                {metricLabels[m].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colorCurrent }]} />
          <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t('stats.current')}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colorPrevious }]} />
          <Text style={[styles.legendLabel, isDark && styles.textDark]}>{t('stats.previous')}</Text>
        </View>
      </View>

      {/* Summary / Tooltip */}
      <View style={[styles.summary, selectedMonth !== null && styles.summaryActive]}>
        {selectedMonth !== null && selectedMonthData ? (
          <>
            <Text style={[styles.tooltipMonth, isDark && styles.textLight]}>
              {selectedMonthData.month}
            </Text>
            <View style={styles.tooltipValues}>
              <View style={styles.tooltipItem}>
                <View style={[styles.legendDot, { backgroundColor: colorCurrent }]} />
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {selectedMonthData.current}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <View style={styles.tooltipItem}>
                <View style={[styles.legendDot, { backgroundColor: colorPrevious }]} />
                <Text style={[styles.tooltipValue, isDark && styles.textLight]}>
                  {selectedMonthData.previous}
                  {metricLabels[metric].unit}
                </Text>
              </View>
              <Text
                style={[
                  styles.tooltipDiff,
                  {
                    color: selectedMonthDiff >= 0 ? colors.success : colors.warning,
                  },
                ]}
              >
                {selectedMonthDiff >= 0 ? '+' : ''}
                {selectedMonthDiff.toFixed(0)}%
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
                {t('stats.current')}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.currentTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, isDark && styles.textDark]}>
                {t('stats.previous')}
              </Text>
              <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                {totals.previousTotal}
                {metricLabels[metric].unit}
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <Text
                style={[
                  styles.summaryValue,
                  { color: totals.diff >= 0 ? colors.success : colors.warning },
                ]}
              >
                {totals.diff >= 0 ? '+' : ''}
                {totals.pctChange}%
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Chart — Skia Picture + transparent PanResponder overlay */}
      <View
        ref={chartRef}
        style={{ height }}
        onLayout={onChartLayout}
        {...panResponder.panHandlers}
      >
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
                isDark && styles.textDark,
                m.isCurrentMonth && styles.currentMonthLabel,
                m.isSelected && styles.selectedMonthLabel,
              ]}
            >
              {m.letter}
            </Text>
          ))}
        </View>
      </View>
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
  textDark: {
    color: darkColors.textSecondary,
  },
  metricSelector: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  metricButtonActive: {
    backgroundColor: colors.primary,
  },
  metricButtonText: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  metricButtonTextActive: {
    color: colors.textOnDark,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    minHeight: 44,
  },
  summaryActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  summaryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: spacing.xs,
  },
  summaryLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginRight: 4,
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
    gap: 4,
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
    color: colors.primary,
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
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
