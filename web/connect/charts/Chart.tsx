// The connect page's chart kit: line, area, bar, stacked and scatter marks on
// one plot with labelled axes, a quiet grid, a legend, a crosshair that follows
// the pointer and the arrow keys, brushing to zoom, and an empty state. Drawn as
// SVG in the page's colour variables, so both colour schemes are covered. The
// drawing is as wide as its card, so text is 12 px at any width.

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { curveAreaSvg, curveLineSvg } from '@/shared/charts/curvePath';
import { bandSvgPath, polylineSvgPath } from '@/shared/charts/svgPath';

import { Button, EmptyState } from '../ui';
import { ValueGrid, XAxisRow } from './Axes';
import {
  TEXT_PX,
  categoryTicks,
  chartMargins,
  indexAtPointer,
  indexRange,
  linearX,
  nearestIndex,
  drawingHeight,
  plotBox,
  valueAxis,
  xAxisTicks,
  xOfIndex,
  yOf,
  type IndexRange,
  type Trend,
} from './scale';
import { Readout, Tooltip } from './Tooltip';
import { useBrush } from './useBrush';
import { useMeasure, useWidth } from './useSize';

export type Kind = 'line' | 'area' | 'bar' | 'stacked' | 'scatter';

export type Series = {
  /** The legend entry and the readout's name for the series. */
  name: string;
  /** A CSS colour, normally one of the page's variables. */
  colour: string;
  /** One value per category; null is a gap. */
  values: (number | null)[];
};

/** A real x position for each category, so points are spaced by their value, not their order. */
export type XValues = {
  values: readonly number[];
  /** A date axis counts milliseconds and ticks on calendar boundaries; a number axis ticks on round values. */
  kind: 'time' | 'number';
  /** Writes a number tick; a date axis writes its own. */
  format?: (value: number) => string;
  /** The locale a date axis writes its labels in. */
  locale?: string;
};

/** One point of a curve band: the curve's value at `time`, and the band's edges there. */
export type CurveBandPoint = { time: number; value: number; lower: number; upper: number };

export type ChartProps = {
  kind: Kind;
  /** One label per category: the readout's heading, and the x axis unless `x` is given. */
  categories: string[];
  series: Series[];
  /** Writes a value for an axis tick and the readout. */
  format: (value: number) => string;
  x?: XValues;
  /** Shaded value ranges behind the marks, clipped to the axis. */
  bands?: { name: string; colour: string; from: number; to: number }[];
  /** For a bar chart, one x axis label per category; null leaves that category unlabelled. */
  tickLabels?: (string | null)[];
  /** The axis titles, with units, drawn beside the axes. */
  xTitle?: string;
  yTitle?: string;
  /** Names the drawing for assistive technology. */
  label: string;
  /** Shown instead of the plot when no value is finite. */
  empty: string;
  /** Written in the readout for a category with no value. */
  none: string;
  /** Called when a scatter dot or a bar is clicked. */
  onPick?: (index: number) => void;
  /** The category drawn as picked. */
  picked?: number | null;
  /** The crosshair's category, when a parent shares it between charts; unset, the chart keeps its own. */
  at?: number | null;
  /** Told the category under the pointer or keys, or null when the crosshair leaves. */
  onAt?: (index: number | null) => void;
  /**
   * The line and band of one standard deviation a scatter draws, as the data's
   * owner fitted them. The chart fits nothing of its own.
   */
  trend?: Trend | null;
  /**
   * Draws a curve through the points' values, with the band between their lower and upper values
   * behind it. A point's `time` is in the x values' units, milliseconds on a date axis. Points
   * outside the visible range are left out of the drawing and of the value axis.
   */
  curveBand?: { points: readonly CurveBandPoint[] };
  /**
   * A line that holds each value until the next x, such as a record that stands until beaten.
   * Its x values are the chart's own, so a date axis takes milliseconds.
   */
  steps?: {
    name: string;
    colour: string;
    points: readonly (readonly [x: number, value: number])[];
  };
  /** Told the categories a brush covers, or null when the zoom is reset. A bar chart cannot be brushed. */
  onRange?: (range: IndexRange | null) => void;
  /** The reset button's text, which appears while zoomed. */
  resetLabel?: string;
  /** The plot's height in pixels. */
  height?: number;
  /** Draws at this width rather than measuring one; for a drawing made without a browser. */
  width?: number;
};

/** The path of a step line: each point's value held across to the next x, the last to `end`. */
function stepPath(
  points: readonly (readonly [number, number])[],
  xScale: { position: (value: number) => number },
  end: number,
  axis: Parameters<typeof yOf>[1],
  box: Parameters<typeof yOf>[2]
): string {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  if (!first) return '';
  let d = `M${xScale.position(first[0])} ${yOf(first[1], axis, box)}`;
  for (const [at, value] of sorted.slice(1)) {
    d += `H${xScale.position(at)}V${yOf(value, axis, box)}`;
  }
  return `${d}H${xScale.position(Math.max(end, sorted[sorted.length - 1]?.[0] ?? end))}`;
}

/** The values the value axis must cover: stacks add up, the rest stand alone. */
function axisValues(kind: Kind, series: Series[], indexes: readonly number[]): number[] {
  if (kind === 'stacked') {
    return indexes.map((i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  }
  return series.flatMap((s) =>
    indexes.flatMap((i) => {
      const v = s.values[i];
      return v == null ? [] : [v];
    })
  );
}

export function Chart(props: ChartProps) {
  const { kind, categories, series, format, label, empty, none } = props;
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const clip = useId().replace(/:/g, '');
  const [own, setOwn] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const shared = props.at !== undefined;
  const at = shared ? (props.at ?? null) : own;
  const setAt = (next: number | null) => {
    if (!shared) setOwn(next);
    props.onAt?.(next);
  };
  const count = categories.length;
  const band = kind === 'bar' || kind === 'stacked';
  const xs = props.x?.values ?? categories.map((_, i) => i);
  const finite = xs.filter(Number.isFinite);
  const full: [number, number] = finite.length
    ? [Math.min(...finite), Math.max(...finite)]
    : [0, Math.max(0, count - 1)];
  const domain = !band && zoom ? zoom : full;
  const visible = (band ? categories.map((_, i) => i) : xs.map((_, i) => i)).filter(
    (i) => band || ((xs[i] ?? NaN) >= domain[0] && (xs[i] ?? NaN) <= domain[1])
  );
  const curvePoints = (props.curveBand?.points ?? []).filter(
    (p) => p.time >= domain[0] && p.time <= domain[1]
  );
  const values = [
    ...axisValues(kind, series, visible),
    ...curvePoints.flatMap((p) => [p.lower, p.upper]),
  ];
  const axis = valueAxis(values, kind !== 'line' && kind !== 'scatter');
  const margins = chartMargins({
    yLabels: axis.ticks.map(format),
    measure,
    xTitle: Boolean(props.xTitle),
    yTitle: Boolean(props.yTitle),
  });
  const height = drawingHeight(width, margins, props.height);
  const box = plotBox(width, height, margins);
  const xScale = linearX(domain, box.left, box.right);
  const x = (i: number) => (band ? xOfIndex(i, count, true, box) : xScale.position(xs[i] ?? NaN));

  const brush = useBrush(xScale, !band && count > 1, (next) => {
    setZoom(next);
    props.onRange?.(indexRange(xs, next[0], next[1]));
  });

  if (count === 0 || values.length === 0) return <EmptyState title={empty} />;

  const indexAt = (px: number) =>
    band ? indexAtPointer(px, count, true, box) : nearestIndex(xs, xScale.value(px));
  const pixelOf = (event: PointerEvent<SVGSVGElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') setAt(null);
    if (step === 0) return;
    event.preventDefault();
    setAt(Math.min(count - 1, Math.max(0, (at ?? (step > 0 ? -1 : count)) + step)));
  };
  const reset = () => {
    setZoom(null);
    props.onRange?.(null);
  };

  const labelled = props.tickLabels
    ? visible.filter((i) => props.tickLabels?.[i] != null)
    : visible;
  const ticks = props.x
    ? xAxisTicks({
        kind: props.x.kind,
        domain,
        box,
        measure,
        width,
        ...(props.x.format ? { format: props.x.format } : {}),
        locale: props.x.locale ?? i18n.language,
      })
    : categoryTicks(
        labelled.map((i) => props.tickLabels?.[i] ?? categories[i] ?? ''),
        labelled.map(x),
        width,
        measure,
        box.left
      );

  const baseline = yOf(Math.max(axis.low, 0), axis, box);
  const bandWidth = ((box.right - box.left) / Math.max(count, 1)) * 0.7;
  const points = (s: Series) =>
    visible.flatMap((i) => {
      const v = s.values[i];
      return v == null ? [] : [{ x: x(i), y: yOf(v, axis, box) }];
    });
  const stackedBase = (i: number, upTo: number) =>
    series.slice(0, upTo).reduce((sum, s) => sum + (s.values[i] ?? 0), 0);

  const trend = kind === 'scatter' ? (props.trend ?? null) : null;
  const trendY = (t: NonNullable<typeof trend>, value: number, offset: number) => {
    const y = yOf(t.intercept + t.slope * value + offset, axis, box);
    return Math.min(box.bottom, Math.max(box.top, y));
  };

  const readout =
    at === null
      ? ' '
      : [
          categories[at],
          ...series.map((s) => `${s.name} ${s.values[at] == null ? none : format(s.values[at])}`),
        ].join(' · ');

  const tipLines =
    at === null || brush.drag
      ? []
      : [
          categories[at] ?? '',
          ...series.map((s) => `${s.name} ${s.values[at] == null ? none : format(s.values[at])}`),
        ];
  const tipX = at === null ? 0 : x(at);

  const dragLeft = brush.drag ? Math.min(brush.drag.from, brush.drag.to) : 0;
  const dragRight = brush.drag ? Math.max(brush.drag.from, brush.drag.to) : 0;

  return (
    <figure className="chart" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fontSize={TEXT_PX}
        role="group"
        aria-label={label}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0 || band) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          brush.start(pixelOf(event));
        }}
        onPointerMove={(event) => {
          const px = pixelOf(event);
          if (brush.drag) brush.move(px);
          else setAt(indexAt(px));
        }}
        onPointerUp={() => {
          brush.end();
        }}
        onPointerCancel={brush.cancel}
        onPointerLeave={() => {
          if (!brush.drag) setAt(null);
        }}
        onDoubleClick={reset}
        onKeyDown={key}
        onBlur={() => setAt(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect
              x={box.left}
              y={box.top}
              width={box.right - box.left}
              height={box.bottom - box.top}
            />
          </clipPath>
        </defs>
        <ValueGrid
          axis={axis}
          box={box}
          format={format}
          title={props.yTitle}
          width={width}
          measure={measure}
        />
        <XAxisRow ticks={ticks} box={box} title={props.xTitle} measure={measure} />
        <g clipPath={`url(#${clip})`}>
          {(props.bands ?? []).flatMap((b) => {
            const top = yOf(Math.min(b.to, axis.high), axis, box);
            const bottom = yOf(Math.max(b.from, axis.low), axis, box);
            return bottom > top
              ? [
                  <rect
                    key={b.name}
                    className="form-band"
                    data-band={b.name}
                    x={box.left}
                    width={box.right - box.left}
                    y={top}
                    height={bottom - top}
                    fill={b.colour}
                  />,
                ]
              : [];
          })}
          {trend ? (
            <>
              <path
                className="trend-band"
                d={`M${xScale.position(domain[0])} ${trendY(trend, domain[0], trend.spread)}L${xScale.position(domain[1])} ${trendY(trend, domain[1], trend.spread)}L${xScale.position(domain[1])} ${trendY(trend, domain[1], -trend.spread)}L${xScale.position(domain[0])} ${trendY(trend, domain[0], -trend.spread)}Z`}
              />
              <line
                className="trend-line"
                x1={xScale.position(domain[0])}
                x2={xScale.position(domain[1])}
                y1={trendY(trend, domain[0], 0)}
                y2={trendY(trend, domain[1], 0)}
              />
            </>
          ) : null}
          {curvePoints.length > 0 ? (
            <>
              <path
                className="curve-band"
                d={bandSvgPath(
                  curvePoints.map((p) => ({
                    x: xScale.position(p.time),
                    y: yOf(p.upper, axis, box),
                  })),
                  curvePoints.map((p) => ({
                    x: xScale.position(p.time),
                    y: yOf(p.lower, axis, box),
                  }))
                )}
              />
              <path
                className="curve-line"
                fill="none"
                d={polylineSvgPath(
                  curvePoints.map((p) => ({
                    x: xScale.position(p.time),
                    y: yOf(p.value, axis, box),
                  }))
                )}
              />
            </>
          ) : null}
          {props.steps && props.steps.points.length > 0 ? (
            <path
              className="mark-line mark-steps"
              d={stepPath(props.steps.points, xScale, domain[1], axis, box)}
              fill="none"
              stroke={props.steps.colour}
            />
          ) : null}
          {kind === 'area'
            ? series.map((s) => {
                const d = curveAreaSvg(points(s), baseline, 'monotone');
                return d ? <path key={s.name} className="mark-area" d={d} fill={s.colour} /> : null;
              })
            : null}
          {kind === 'line' || kind === 'area'
            ? series.map((s) => {
                const pts = points(s);
                const d =
                  pts.length > 40
                    ? polylineSvgPath(pts)
                    : (curveLineSvg(pts, 'monotone') ?? polylineSvgPath(pts));
                return (
                  <path key={s.name} className="mark-line" d={d} fill="none" stroke={s.colour} />
                );
              })
            : null}
          {kind === 'bar'
            ? series.flatMap((s, n) =>
                s.values.map((v, i) => {
                  if (v === null) return null;
                  const barWidth = bandWidth / series.length;
                  const top = Math.min(yOf(v, axis, box), baseline);
                  return (
                    <rect
                      key={`${s.name}-${i}`}
                      className="mark-bar"
                      x={x(i) - bandWidth / 2 + n * barWidth}
                      y={top}
                      width={Math.max(barWidth - 1, 1)}
                      height={Math.abs(yOf(v, axis, box) - baseline)}
                      fill={s.colour}
                      onClick={() => props.onPick?.(i)}
                    />
                  );
                })
              )
            : null}
          {kind === 'stacked'
            ? series.flatMap((s, n) =>
                s.values.map((v, i) => {
                  if (!v) return null;
                  const below = stackedBase(i, n);
                  return (
                    <rect
                      key={`${s.name}-${i}`}
                      className="mark-bar"
                      x={x(i) - bandWidth / 2}
                      y={yOf(below + v, axis, box)}
                      width={bandWidth}
                      height={yOf(below, axis, box) - yOf(below + v, axis, box)}
                      fill={s.colour}
                    />
                  );
                })
              )
            : null}
          {kind === 'scatter'
            ? series.flatMap((s) =>
                visible.map((i) => {
                  const v = s.values[i];
                  return v == null ? null : (
                    <circle
                      key={`${s.name}-${i}`}
                      className={i === props.picked ? 'mark-dot picked' : 'mark-dot'}
                      cx={x(i)}
                      cy={yOf(v, axis, box)}
                      r={5}
                      fill={s.colour}
                      onClick={() => props.onPick?.(i)}
                    />
                  );
                })
              )
            : null}
        </g>
        {at === null ? null : (
          <line className="crosshair" x1={x(at)} x2={x(at)} y1={box.top} y2={box.bottom} />
        )}
        {at === null || band
          ? null
          : series.map((s) => {
              const v = s.values[at];
              return v == null ? null : (
                <circle
                  key={s.name}
                  className="crosshair-dot"
                  cx={x(at)}
                  cy={yOf(v, axis, box)}
                  r={4}
                  fill={s.colour}
                />
              );
            })}
        {brush.drag ? (
          <rect
            className="brush"
            x={dragLeft}
            y={box.top}
            width={dragRight - dragLeft}
            height={box.bottom - box.top}
          />
        ) : null}
      </svg>
      {series.length > 1 || kind === 'stacked' || props.steps ? (
        <ul className="legend">
          {[...series, ...(props.steps ? [props.steps] : [])].map((s) => (
            <li key={s.name}>
              <span className="swatch" style={{ background: s.colour }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <Tooltip lines={tipLines} x={tipX} left={box.left} right={box.right} top={box.top} measure={measure} />
      <Readout text={readout} />
      {zoom ? (
        <Button size="sm" variant="ghost" onClick={reset}>
          {props.resetLabel ?? t('connectPage.chart.reset')}
        </Button>
      ) : null}
    </figure>
  );
}
