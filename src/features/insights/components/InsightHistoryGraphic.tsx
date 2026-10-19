/**
 * An insight card's history, drawn across the card under its title.
 *
 * One drawing per kind the generator chose: a timeline of efforts with the
 * marked one ringed, a sparkline with the marked span shaded, weekly bars with
 * the marked week in colour and a running week in outline, the section's line,
 * or one signed change per row. The mark is drawn in the category colour and
 * everything else is muted, so the card says which point the claim is about. A
 * series prints the values at its top and bottom edge in a gutter on the right
 * and its first and last dates beneath, so the shape reads against a scale.
 * The graphic is its own press target and opens what it pictures, the
 * history's target, while the card around it opens the sheet. Changes picture
 * the sheet's own rows, so they open the sheet.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { Circle, Path, Rect } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';

import {
  ChartBar,
  ChartDot,
  chartStroke,
  groupedBarCentre,
  groupedBarWidth,
  LINE_CAP,
  LINE_JOIN,
} from '@/shared/charts';

import { navigateTo } from '@/shared/app/navigation';
import { formatShortDate } from '@/shared/format/format';
import { ChartErrorBoundary, PressTarget } from '@/shared/ui';
import { fitTrackToBox, normaliseTrackPoints, trackPreviewPalette } from '@/shared/ui/TrackPreview';
import {
  chartStyles,
  colors,
  colorWithOpacity,
  colourTokens,
  darkColors,
  opacity,
  spacing,
  typography,
  verdictColor,
} from '@/theme';
import { historyRange } from '../lib/sparkline';
import type {
  HistoryChange,
  HistoryMark,
  HistorySeries,
  InsightHistory,
  SeriesPoint,
} from '../types';

/** The height the card's graphic is drawn at, the smallest at which its mark reads. */
export const GRAPHIC_HEIGHT = spacing.xxl;

/** Room for a ringed point at the top and bottom edge without clipping it. */
const INSET = spacing.xsPlus;
/** A timeline's muted effort, a context point under the line rather than a mark. */
const DOT_RADIUS = 2;
const LINE_WIDTH = chartStroke.series;

interface Box {
  width: number;
  height: number;
}

interface Palette {
  mark: string;
  markSecond: string;
  muted: string;
  mutedLine: string;
  shade: string;
}

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

/**
 * A dated series into the box: dates across, and values between the range's
 * top and bottom, which is where the printed scale says they are.
 */
function placeSeries(points: SeriesPoint[], box: Box, kind: 'timeline' | 'sparkline') {
  const dates = points.map((p) => p.date);
  const firstDate = Math.min(...dates);
  const dateSpan = Math.max(...dates) - firstDate;
  const range = historyRange(
    kind,
    points.map((p) => p.value)
  );
  const w = box.width - INSET * 2;
  const h = box.height - INSET * 2;
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
  box,
  palette,
}: {
  kind: 'timeline' | 'sparkline';
  series: HistorySeries;
  mark: HistoryMark | undefined;
  box: Box;
  palette: Palette;
}) {
  const placed = useMemo(() => placeSeries(series.points, box, kind), [series.points, box, kind]);
  const span = mark && 'from' in mark ? placed.filter((p) => isMarked(p.date, mark)) : [];
  const marked = mark && 'date' in mark ? placed.find((p) => p.date === mark.date) : undefined;
  const last = placed[placed.length - 1];

  return (
    <>
      {span.length > 0 ? (
        <Rect
          x={span[0].x}
          y={0}
          width={Math.max(span[span.length - 1].x - span[0].x, LINE_WIDTH)}
          height={box.height}
          color={palette.shade}
        />
      ) : null}
      <Path
        path={linePath(placed)}
        style="stroke"
        strokeWidth={LINE_WIDTH}
        strokeJoin={LINE_JOIN}
        strokeCap={LINE_CAP}
        color={palette.mutedLine}
      />
      {span.length > 1 ? (
        <Path
          path={linePath(span)}
          style="stroke"
          strokeWidth={LINE_WIDTH}
          strokeJoin={LINE_JOIN}
          strokeCap={LINE_CAP}
          color={palette.mark}
        />
      ) : null}
      {kind === 'timeline'
        ? placed.map((p, index) => (
            <Circle key={index} cx={p.x} cy={p.y} r={DOT_RADIUS} color={palette.mutedLine} />
          ))
        : null}
      {marked ? <ChartDot x={marked.x} y={marked.y} color={palette.mark} /> : null}
      {kind === 'sparkline' && last ? (
        <ChartDot x={last.x} y={last.y} color={palette.mark} />
      ) : null}
    </>
  );
}

/**
 * Weekly bars from zero, one slot per week and one bar per series in it. The
 * marked week is drawn in colour, its second series at a lighter tone, and a
 * week still running is drawn in outline, since its total is only the days so
 * far.
 */
function BarsDrawing({
  series,
  mark,
  box,
  palette,
}: {
  series: HistorySeries[];
  mark: HistoryMark | undefined;
  box: Box;
  palette: Palette;
}) {
  const weeks = series[0]?.points ?? [];
  const range = historyRange(
    'bars',
    series.flatMap((s) => s.points.map((p) => p.value))
  );
  const span = range.top - range.bottom || 1;
  const h = box.height - INSET * 2;
  const zeroY = INSET + downFrom(range, 0) * h;
  const slot = (box.width - INSET * 2) / Math.max(weeks.length, 1);
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

/**
 * One bar per change from a zero line, above it the better way and below it
 * the worse, each in the verdict ladder's rung for its sign.
 */
function ChangesDrawing({
  bars,
  box,
  palette,
  isDark,
}: {
  bars: HistoryChange[];
  box: Box;
  palette: Palette;
  isDark: boolean;
}) {
  const range = historyRange(
    'bars',
    bars.map((bar) => bar.value)
  );
  const span = range.top - range.bottom || 1;
  const h = box.height - INSET * 2;
  const zeroY = INSET + downFrom(range, 0) * h;
  const slot = (box.width - INSET * 2) / Math.max(bars.length, 1);
  const barWidth = groupedBarWidth(slot, 1);

  return (
    <>
      <Path
        path={linePath([
          { x: INSET, y: zeroY },
          { x: box.width - INSET, y: zeroY },
        ])}
        style="stroke"
        strokeWidth={chartStroke.axis}
        color={palette.mutedLine}
      />
      {bars.map((bar, index) => {
        const length = (Math.abs(bar.value) / span) * h;
        const rung = bar.value > 0 ? 'positive' : bar.value < 0 ? 'negative' : 'neutral';
        return (
          <ChartBar
            key={bar.key}
            x={INSET + (index + 0.5) * slot}
            from={zeroY}
            to={bar.value >= 0 ? zeroY - length : zeroY + length}
            width={barWidth}
            color={verdictColor(rung, isDark)}
          />
        );
      })}
    </>
  );
}

/** The section's line on the base map's flat land, its own proportions kept. */
function LineDrawing({
  history,
  box,
  palette,
  isDark,
}: {
  history: Extract<InsightHistory, { kind: 'line' }>;
  box: Box;
  palette: Palette;
  isDark: boolean;
}) {
  const path = useMemo(
    () =>
      linePath(fitTrackToBox(normaliseTrackPoints(history.points), box.width, box.height, INSET)),
    [history.points, box]
  );
  return (
    <>
      <Rect
        x={0}
        y={0}
        width={box.width}
        height={box.height}
        color={trackPreviewPalette(isDark).land}
      />
      <Path
        path={path}
        style="stroke"
        strokeWidth={LINE_WIDTH}
        strokeCap={LINE_CAP}
        strokeJoin={LINE_JOIN}
        color={palette.mark}
      />
    </>
  );
}

interface InsightHistoryGraphicProps {
  history: InsightHistory;
  color: string;
  isDark: boolean;
  /** Where the graphic goes, for a screen reader. */
  accessibilityLabel: string;
  /** Opens the card's sheet, for a history that pictures the sheet's rows. */
  onOpenSheet: () => void;
}

export const InsightHistoryGraphic = React.memo(function InsightHistoryGraphic({
  history,
  color,
  isDark,
  accessibilityLabel,
  onOpenSheet,
}: InsightHistoryGraphicProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);
  const target = history.kind === 'changes' ? undefined : history.target;
  const onPress = useCallback(
    () => (target ? navigateTo(target) : onOpenSheet()),
    [target, onOpenSheet]
  );

  const box = useMemo(() => ({ width, height: GRAPHIC_HEIGHT }), [width]);
  const secondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const scale = 'scale' in history ? history.scale : undefined;
  const dates = useMemo(() => {
    const points = 'series' in history ? history.series[0]?.points : undefined;
    if (!points?.length) return null;
    const days = points.map((point) => point.date);
    return [Math.min(...days), Math.max(...days)].map((seconds) =>
      formatShortDate(new Date(seconds * 1000))
    );
  }, [history]);
  const palette: Palette = {
    mark: color,
    markSecond: colorWithOpacity(color, 0.55),
    muted: colourTokens[isDark ? 'dark' : 'light']['chart-muted'],
    mutedLine: colorWithOpacity(secondary, opacity.disabled),
    shade: colorWithOpacity(color, opacity.tint2),
  };

  let drawing: React.ReactNode = null;
  if (width > 0) {
    if (history.kind === 'line') {
      drawing = <LineDrawing history={history} box={box} palette={palette} isDark={isDark} />;
    } else if (history.kind === 'changes') {
      drawing = <ChangesDrawing bars={history.bars} box={box} palette={palette} isDark={isDark} />;
    } else if (history.kind === 'bars') {
      drawing = (
        <BarsDrawing series={history.series} mark={history.mark} box={box} palette={palette} />
      );
    } else if (history.series[0]) {
      drawing = (
        <SeriesDrawing
          kind={history.kind}
          series={history.series[0]}
          mark={history.mark}
          box={box}
          palette={palette}
        />
      );
    }
  }

  const labelStyle = [styles.label, { color: secondary }];

  return (
    <PressTarget
      testID="insight-graphic"
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={[styles.graphic, chartStyles.plotDirection]}
    >
      <View style={styles.plotColumn}>
        <View testID="insight-graphic-plot" style={styles.plot} onLayout={onLayout}>
          {drawing ? (
            <ChartErrorBoundary height={GRAPHIC_HEIGHT}>
              <Canvas style={box}>{drawing}</Canvas>
            </ChartErrorBoundary>
          ) : null}
        </View>
        {dates ? (
          <View testID="insight-graphic-dates" style={styles.dates}>
            <Text style={labelStyle}>{dates[0]}</Text>
            <Text style={labelStyle}>{dates[1]}</Text>
          </View>
        ) : null}
      </View>
      {scale ? (
        <View testID="insight-graphic-scale" style={styles.scale}>
          <Text style={labelStyle}>{scale.top}</Text>
          <Text style={labelStyle}>{scale.bottom}</Text>
        </View>
      ) : null}
    </PressTarget>
  );
});

const styles = StyleSheet.create({
  graphic: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  plotColumn: {
    flex: 1,
  },
  plot: {
    height: GRAPHIC_HEIGHT,
  },
  dates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: INSET,
  },
  // The top and bottom labels sit level with the drawing's top and bottom
  // values, which are inset from its edges by the ring's room.
  scale: {
    height: GRAPHIC_HEIGHT,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingVertical: INSET - typography.micro.lineHeight / 2,
  },
  label: {
    ...typography.micro,
    fontVariant: ['tabular-nums'],
  },
});
