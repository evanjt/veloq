/**
 * The small trend at the end of an insight row, for a type whose shape answers
 * the card's question faster than its number.
 *
 * A fixed strip that never stretches. A timeline of efforts is a line with
 * each effort dotted and the marked one in the category colour, drawn faster
 * up; a sparkline is a line with the marked span in colour and its latest
 * reading dotted; weekly bars stand on zero with the compared week in colour
 * and a running week in outline, since its total is only the days so far. It
 * prints no scale and no dates and is no press target of its own: the row
 * opens the sheet, which draws the same history labelled.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Circle, Path } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';

import {
  ChartBar,
  chartStroke,
  groupedBarCentre,
  groupedBarWidth,
  LINE_CAP,
  LINE_JOIN,
} from '@/shared/charts';
import { ChartErrorBoundary } from '@/shared/ui';
import {
  chartStyles,
  colors,
  colorWithOpacity,
  colourTokens,
  darkColors,
  opacity,
  spacing,
} from '@/theme';
import { historyRange } from '../lib/sparkline';
import type { HistoryMark, HistorySeries, InsightHistory, SeriesPoint } from '../types';

/** The strip the trend is drawn in, the same on every row. */
const TREND_WIDTH = spacing.xxl;
const TREND_HEIGHT = spacing.md + spacing.xs;
const BOX = { width: TREND_WIDTH, height: TREND_HEIGHT };

/** Room for the marked dot at the strip's edges without clipping it. */
const INSET = spacing.xxs;
/** The marked or latest point, read against the line under it. */
const MARK_RADIUS = spacing.xxs;
/** A timeline's other efforts, context under the line rather than a mark. */
const POINT_RADIUS = chartStroke.series / 2;

interface Palette {
  mark: string;
  markSecond: string;
  muted: string;
  mutedLine: string;
}

type SeriesHistory = Extract<InsightHistory, { series: HistorySeries[] }>;

function isMarked(date: number, mark: HistoryMark | undefined): boolean {
  if (!mark) return false;
  return 'date' in mark ? date === mark.date : date >= mark.from && date <= mark.to;
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** How far down the drawable height a value sits, between the range's top and bottom edge. */
function downFrom(range: { top: number; bottom: number }, value: number): number {
  return (range.top - value) / (range.top - range.bottom || 1);
}

/** A dated series into the strip: dates across, values between the range's top and bottom. */
function placeSeries(points: SeriesPoint[], kind: 'timeline' | 'sparkline') {
  const dates = points.map((p) => p.date);
  const firstDate = Math.min(...dates);
  const dateSpan = Math.max(...dates) - firstDate;
  const range = historyRange(
    kind,
    points.map((p) => p.value)
  );
  const w = TREND_WIDTH - INSET * 2;
  const h = TREND_HEIGHT - INSET * 2;
  return points.map((point, index) => {
    const along =
      dateSpan > 0
        ? (point.date - firstDate) / dateSpan
        : points.length > 1
          ? index / (points.length - 1)
          : 0.5;
    return {
      x: INSET + along * w,
      y: INSET + downFrom(range, point.value) * h,
      date: point.date,
    };
  });
}

function SeriesDrawing({
  kind,
  series,
  mark,
  palette,
}: {
  kind: 'timeline' | 'sparkline';
  series: HistorySeries;
  mark: HistoryMark | undefined;
  palette: Palette;
}) {
  const placed = useMemo(() => placeSeries(series.points, kind), [series.points, kind]);
  const span = mark && 'from' in mark ? placed.filter((p) => isMarked(p.date, mark)) : [];
  const marked =
    kind === 'timeline' ? placed.find((p) => isMarked(p.date, mark)) : placed[placed.length - 1];

  return (
    <>
      <Path
        path={linePath(placed)}
        style="stroke"
        strokeWidth={chartStroke.series}
        strokeJoin={LINE_JOIN}
        strokeCap={LINE_CAP}
        color={palette.mutedLine}
      />
      {span.length > 1 ? (
        <Path
          path={linePath(span)}
          style="stroke"
          strokeWidth={chartStroke.series}
          strokeJoin={LINE_JOIN}
          strokeCap={LINE_CAP}
          color={palette.mark}
        />
      ) : null}
      {kind === 'timeline'
        ? placed
            .filter((p) => p !== marked)
            .map((p, index) => (
              <Circle key={index} cx={p.x} cy={p.y} r={POINT_RADIUS} color={palette.mutedLine} />
            ))
        : null}
      {marked ? <Circle cx={marked.x} cy={marked.y} r={MARK_RADIUS} color={palette.mark} /> : null}
    </>
  );
}

/** Weekly bars from zero, one slot per week and one bar per series in it. */
function BarsDrawing({
  series,
  mark,
  palette,
}: {
  series: HistorySeries[];
  mark: HistoryMark | undefined;
  palette: Palette;
}) {
  const weeks = series[0]?.points ?? [];
  const range = historyRange(
    'bars',
    series.flatMap((s) => s.points.map((p) => p.value))
  );
  const span = range.top - range.bottom || 1;
  const h = TREND_HEIGHT - INSET * 2;
  const zeroY = INSET + downFrom(range, 0) * h;
  const slot = (TREND_WIDTH - INSET * 2) / Math.max(weeks.length, 1);
  const barWidth = groupedBarWidth(slot, series.length);

  return (
    <>
      {series.flatMap((s, seriesIndex) =>
        s.points.map((point, weekIndex) => {
          const marked = isMarked(point.date, mark);
          const length = (Math.abs(point.value) / span) * h;
          return (
            <ChartBar
              key={`${seriesIndex}-${weekIndex}`}
              x={groupedBarCentre(
                INSET + (weekIndex + 0.5) * slot,
                barWidth,
                series.length,
                seriesIndex
              )}
              from={zeroY}
              to={point.value >= 0 ? zeroY - length : zeroY + length}
              width={barWidth}
              color={
                marked ? (seriesIndex === 0 ? palette.mark : palette.markSecond) : palette.muted
              }
              outline={point.partial === true}
            />
          );
        })
      )}
    </>
  );
}

/** The history a row can draw: a dated series with at least two points. */
export function rowTrendHistory(history: InsightHistory | undefined): SeriesHistory | null {
  if (!history || !('series' in history)) return null;
  return (history.series[0]?.points.length ?? 0) >= 2 ? history : null;
}

interface InsightRowTrendProps {
  history: SeriesHistory;
  color: string;
  isDark: boolean;
}

export const InsightRowTrend = React.memo(function InsightRowTrend({
  history,
  color,
  isDark,
}: InsightRowTrendProps) {
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const palette: Palette = {
    mark: color,
    markSecond: colorWithOpacity(color, opacity.disabled),
    muted: colourTokens[isDark ? 'dark' : 'light']['chart-muted'],
    mutedLine: colorWithOpacity(secondary, opacity.disabled),
  };
  const first = history.series[0];

  return (
    <View testID="insight-row-trend" style={[styles.strip, chartStyles.plotDirection]}>
      <ChartErrorBoundary height={TREND_HEIGHT}>
        <Canvas style={BOX}>
          {history.kind === 'bars' ? (
            <BarsDrawing series={history.series} mark={history.mark} palette={palette} />
          ) : first ? (
            <SeriesDrawing
              kind={history.kind}
              series={first}
              mark={history.mark}
              palette={palette}
            />
          ) : null}
        </Canvas>
      </ChartErrorBoundary>
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
  },
});
