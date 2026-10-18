import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/shared/app';
import { ChartErrorBoundary } from '@/shared/ui';
import { colorWithOpacity, ink, layout, opacity, spacing } from '@/theme';
import type { HistoryMark, InsightCategory, InsightHistory, SeriesPoint } from '../types';
import { insightGraphicColour } from '../lib/insightCategory';
import { InsightSeriesChart, type InsightFurtherSeries } from './InsightSeriesChart';
import { formatDecimal } from '@/shared/format/number';

const CHART_HEIGHT = 180;

/** A series value as precise as its range needs, with the series' unit when it has one. */
export function formatSeriesValue(
  value: number,
  decimals: number,
  unit: string | undefined
): string {
  const number = formatDecimal(value, decimals);
  return unit ? `${number} ${unit}` : number;
}

/**
 * The sample the card's mark points at: the marked date, or the newest sample
 * inside a marked span, which is the value the card's claim ends on.
 */
function markedIndex(points: SeriesPoint[], mark: HistoryMark | undefined): number {
  if (!mark) return -1;
  if ('date' in mark) return points.findIndex((point) => point.date === mark.date);
  let index = -1;
  points.forEach((point, i) => {
    if (point.date >= mark.from && point.date <= mark.to) index = i;
  });
  return index;
}

interface InsightHistoryChartProps {
  /** The card's own history, which the sheet draws whole. */
  history: InsightHistory | undefined;
  /**
   * The card's category, which names what the history measures and so the
   * colour it is drawn in. The verdict is the badge's, never the series'.
   */
  category: InsightCategory;
  /** Shown at the title's trailing edge, such as a glyph for the series' verdict. */
  accessory?: React.ReactNode;
}

/**
 * The history the card drew, at full size in its sheet: every sample, on the
 * shared scrubbable chart, bars where the card drew bars and a timeline's
 * fastest effort at the top, every series with a key naming each. The card's
 * mark is the chart's marker. A history with no dated series, a section's
 * line or the section trend's changes, is drawn by its kind's own sheet
 * content instead.
 */
export const InsightHistoryChart = React.memo(function InsightHistoryChart({
  history,
  category,
  accessory,
}: InsightHistoryChartProps) {
  const { isDark } = useTheme();
  const color = insightGraphicColour(category, isDark);
  const allSeries = history && 'series' in history ? history.series : undefined;
  const series = allSeries?.[0];
  const kind = history && 'series' in history ? history.kind : undefined;
  const mark = history && 'series' in history ? history.mark : undefined;
  const points = series?.points;
  const format = series?.format;
  const unit = series?.unit;

  const formatValue = useCallback(
    (value: number, decimals: number) =>
      format ? format(value) : formatSeriesValue(value, decimals, unit),
    [format, unit]
  );
  const marker = useMemo(() => {
    const index = points ? markedIndex(points, mark) : -1;
    return index >= 0 ? { index, kind: 'this' as const } : null;
  }, [points, mark]);

  // A further series is the first's colour at a lighter tone, as the card draws it.
  const others = useMemo<InsightFurtherSeries[]>(
    () =>
      (allSeries ?? []).slice(1).map((other) => ({
        label: other.label,
        samples: other.points,
        color: colorWithOpacity(color, opacity.disabled),
      })),
    [allSeries, color]
  );

  if (!series || !points || points.length < 2) return null;

  const timeline = kind === 'timeline';
  const dotColor = isDark
    ? colorWithOpacity(ink.white, opacity.dim)
    : colorWithOpacity(ink.black, opacity.tint3);

  return (
    <ChartErrorBoundary height={CHART_HEIGHT}>
      <View testID="insight-history-chart" style={[styles.card, isDark && styles.cardDark]}>
        <InsightSeriesChart
          samples={points}
          title={(allSeries ?? [series]).map((each) => each.label).join(' · ')}
          label={series.label}
          color={color}
          others={others}
          formatValue={formatValue}
          invert={timeline}
          bars={kind === 'bars'}
          marker={marker}
          accessory={accessory}
          {...(timeline ? { pointColor: dotColor } : {})}
        />
      </View>
    </ChartErrorBoundary>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
  },
  cardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
