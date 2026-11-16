// Lanes stacked on one shared x axis, distance or time. Every lane keeps its own
// value scale and unit, and a sample has the same x in all of them, so one
// crosshair runs through the stack and one readout names every lane. A drag
// across the stack zooms every lane to that range, a button resets it, and the
// range is reported as sample indexes.

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui';
import { ValueGrid, XAxisRow } from './Axes';
import {
  LANE_HEIGHT,
  TEXT_PX,
  chartMargins,
  indexRange,
  linearX,
  nearestIndex,
  stackLayout,
  tooltipLeft,
  valueAxis,
  visibleIndexes,
  xAxisTicks,
  yOf,
  type Box,
  type IndexRange,
  type ValueAxis,
} from './scale';
import { useBrush } from './useBrush';
import { useMeasure, useWidth } from './useSize';

export type LaneSeries = {
  key: string;
  name: string;
  unit: string;
  /** A CSS colour from the stream tokens. */
  colour: string;
  /** One value per shared sample; a gap is NaN. */
  values: readonly number[];
  /** Fill under the line, for a quantity whose area reads as an amount. */
  fill?: boolean;
  /** Pin the low end of the scale at or below zero. */
  zero?: boolean;
  /** Writes a value for the tick labels and the readout. */
  format?: (value: number) => string;
};

export type LanesProps = {
  /** The shared x value of every sample, which do not decrease: metres, or seconds. */
  xs: readonly number[];
  /** A number axis ticks on round values; a duration axis on whole minutes and hours. */
  xKind: 'number' | 'duration';
  /** Writes an x value for a tick and the readout's heading. */
  xFormat: (value: number) => string;
  xTitle: string;
  lanes: readonly LaneSeries[];
  /** The crosshair's sample, shared with whatever else shows the position. */
  at: number | null;
  onAt: (index: number | null) => void;
  /** Told the samples a brush covers, or null when the zoom is reset. */
  onRange?: (range: IndexRange | null) => void;
  /** A range the page sets from outside, such as a chosen interval; it zooms the lanes to it until it is null or the zoom is reset. */
  focus?: IndexRange | null;
  label: string;
  /** Written in the readout for a lane with no value at the sample. */
  none: string;
  resetLabel?: string;
  /** Draws at this width rather than measuring one; for a drawing made without a browser. */
  width?: number;
  /** The most samples a lane draws; a longer range is thinned evenly. */
  maxPoints?: number;
};

const DEFAULT_MAX_POINTS = 400;

/** The tooltip's padding on each side, matching its stylesheet. */
const TOOLTIP_PAD = 8;

const plain = (value: number) => String(Math.round(value * 10) / 10);

const finiteIn = (values: readonly number[], indexes: readonly number[]) =>
  indexes.flatMap((i) => {
    const v = values[i];
    return v !== undefined && Number.isFinite(v) ? [v] : [];
  });

/** A lane's line as subpaths that break at every gap; a lone sample is a zero-length segment. */
function runs(points: ({ x: number; y: number } | null)[]): { line: string; runs: { x: number; y: number }[][] } {
  const groups: { x: number; y: number }[][] = [];
  let open: { x: number; y: number }[] | null = null;
  for (const point of points) {
    if (!point) {
      open = null;
      continue;
    }
    if (!open) {
      open = [];
      groups.push(open);
    }
    open.push(point);
  }
  const at = (p: { x: number; y: number }) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const line = groups
    .map(([head, ...rest]) =>
      head ? `M${at(head)}${rest.length === 0 ? `L${at(head)}` : rest.map((p) => `L${at(p)}`).join('')}` : ''
    )
    .join('');
  return { line, runs: groups };
}

function areaPath(group: { x: number; y: number }[], baseline: number): string {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first || !last) return '';
  return `M${first.x.toFixed(1)} ${baseline.toFixed(1)}${group.map((p) => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')}L${last.x.toFixed(1)} ${baseline.toFixed(1)}Z`;
}

export function Lanes(props: LanesProps) {
  const { xs, lanes } = props;
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const clip = useId().replace(/:/g, '');
  const [zoom, setZoom] = useState<[number, number] | null>(null);

  const first = xs[0];
  const last = xs[xs.length - 1];
  const full: [number, number] = [first ?? 0, last ?? 0];
  const focused: [number, number] | null =
    props.focus && xs[props.focus.from] !== undefined && xs[props.focus.to] !== undefined
      ? [xs[props.focus.from] as number, xs[props.focus.to] as number]
      : null;
  const domain = focused ?? zoom ?? full;
  const picks = visibleIndexes(xs, domain[0], domain[1], props.maxPoints ?? DEFAULT_MAX_POINTS);

  const axes: ValueAxis[] = lanes.map((lane) =>
    valueAxis(finiteIn(lane.values, picks), lane.zero ?? false, 3)
  );
  const formats = lanes.map((lane) => lane.format ?? plain);
  const margins = chartMargins({
    yLabels: axes.flatMap((axis, n) => axis.ticks.map(formats[n] ?? plain)),
    measure,
    xTitle: true,
    yTitle: true,
  });
  const stack = stackLayout({ width, lanes: lanes.length, laneHeight: LANE_HEIGHT, margins });
  const edge: Box | undefined = stack.lanes[0]?.box;
  const xScale = linearX(domain, edge?.left ?? 0, edge?.right ?? width);
  const brush = useBrush(xScale, xs.length > 1, (next) => {
    setZoom(next);
    props.onRange?.(indexRange(xs, next[0], next[1]));
  });

  const lastBox = stack.lanes[stack.lanes.length - 1]?.box;
  if (xs.length === 0 || lanes.length === 0 || !edge || !lastBox) return null;
  const top = edge.top;
  const bottom = lastBox.bottom;

  const pixelOf = (event: PointerEvent<SVGSVGElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') props.onAt(null);
    if (step === 0) return;
    event.preventDefault();
    const from = props.at ?? (step > 0 ? -1 : xs.length);
    props.onAt(Math.min(xs.length - 1, Math.max(0, from + step)));
  };
  const reset = () => {
    setZoom(null);
    props.onRange?.(null);
  };

  const ticks = xAxisTicks({
    kind: props.xKind,
    domain,
    box: edge,
    measure,
    width,
    format: props.xFormat,
  });
  const atX = props.at === null ? null : xScale.position(xs[props.at] ?? NaN);
  const lines =
    props.at === null
      ? []
      : [
          props.xFormat(xs[props.at] ?? NaN),
          ...lanes.map((lane, n) => {
            const v = lane.values[props.at ?? 0];
            const shown = v !== undefined && Number.isFinite(v) ? (formats[n] ?? plain)(v) : props.none;
            return `${lane.name} ${shown}${shown === props.none ? '' : ` ${lane.unit}`}`;
          }),
        ];
  const readout = props.at === null ? ' ' : lines.join(' · ');
  const tipLines = brush.drag ? [] : lines;
  const tipWidth = Math.ceil(Math.max(0, ...tipLines.map(measure))) + 2 * TOOLTIP_PAD;
  const dragLeft = brush.drag ? Math.min(brush.drag.from, brush.drag.to) : 0;
  const dragRight = brush.drag ? Math.max(brush.drag.from, brush.drag.to) : 0;

  return (
    <figure className="chart lanes" ref={ref}>
      <svg
        width={width}
        height={stack.height}
        viewBox={`0 0 ${width} ${stack.height}`}
        fontSize={TEXT_PX}
        role="group"
        aria-label={props.label}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          brush.start(pixelOf(event));
        }}
        onPointerMove={(event) => {
          const px = pixelOf(event);
          if (brush.drag) brush.move(px);
          else {
            const index = nearestIndex(xs, xScale.value(px));
            props.onAt(index < 0 ? null : index);
          }
        }}
        onPointerUp={() => {
          brush.end();
        }}
        onPointerCancel={brush.cancel}
        onPointerLeave={() => {
          if (!brush.drag) props.onAt(null);
        }}
        onDoubleClick={reset}
        onKeyDown={key}
        onBlur={() => props.onAt(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={edge.left} y={top} width={edge.right - edge.left} height={bottom - top} />
          </clipPath>
        </defs>
        {lanes.map((lane, n) => {
          const box = stack.lanes[n]?.box;
          const axis = axes[n];
          if (!box || !axis) return null;
          const points = picks.map((i) => {
            const v = lane.values[i];
            return v !== undefined && Number.isFinite(v)
              ? { x: xScale.position(xs[i] ?? NaN), y: yOf(v, axis, box) }
              : null;
          });
          const drawn = runs(points);
          const baseline = yOf(Math.max(axis.low, 0), axis, box);
          const dot = props.at === null ? undefined : lane.values[props.at];
          return (
            <g key={lane.key} className="lane" data-lane={lane.key}>
              <ValueGrid
                axis={axis}
                box={box}
                format={formats[n] ?? plain}
                title={`${lane.name} (${lane.unit})`}
                width={width}
                measure={measure}
              />
              <g clipPath={`url(#${clip})`}>
                {lane.fill
                  ? drawn.runs.map((group, g) => (
                      <path key={g} className="mark-area" d={areaPath(group, baseline)} fill={lane.colour} />
                    ))
                  : null}
                <path className="mark-line" d={drawn.line} fill="none" stroke={lane.colour} />
              </g>
              {dot !== undefined && Number.isFinite(dot) && atX !== null ? (
                <circle className="crosshair-dot" cx={atX} cy={yOf(dot, axis, box)} r={4} fill={lane.colour} />
              ) : null}
            </g>
          );
        })}
        <XAxisRow ticks={ticks} box={lastBox} title={props.xTitle} measure={measure} />
        {atX === null ? null : <line className="crosshair" x1={atX} x2={atX} y1={top} y2={bottom} />}
        {brush.drag ? (
          <rect className="brush" x={dragLeft} y={top} width={dragRight - dragLeft} height={bottom - top} />
        ) : null}
      </svg>
      {tipLines.length > 0 && atX !== null ? (
        <div
          className="chart-tooltip"
          style={{
            left: tooltipLeft(atX, tipWidth, edge.left, edge.right),
            top: edge.top,
            width: tipWidth,
          }}
        >
          {tipLines.map((line, n) => (
            <div key={n}>{line}</div>
          ))}
        </div>
      ) : null}
      <p className="readout" aria-live="polite">
        {readout}
      </p>
      {zoom || focused ? (
        <Button size="sm" variant="ghost" onClick={reset}>
          {props.resetLabel ?? t('connectPage.chart.reset')}
        </Button>
      ) : null}
    </figure>
  );
}
