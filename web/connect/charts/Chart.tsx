// The connect page's chart kit: line, area, bar, stacked and scatter marks on
// one plot with labelled axes, a quiet grid, a legend, a crosshair that follows
// the pointer and the arrow keys, and an empty state. Drawn as SVG in the
// page's colour variables, so both colour schemes are covered.

import { useState, type KeyboardEvent, type PointerEvent } from 'react';

import { curveAreaSvg, curveLineSvg } from '@/shared/charts/curvePath';
import { polylineSvgPath } from '@/shared/charts/svgPath';

import {
  CHART_HEIGHT,
  CHART_WIDTH,
  PLOT,
  indexAtPointer,
  labelIndexes,
  valueAxis,
  xOfIndex,
  yOf,
} from './scale';

export type Kind = 'line' | 'area' | 'bar' | 'stacked' | 'scatter';

export type Series = {
  /** The legend entry and the readout's name for the series. */
  name: string;
  /** A CSS colour, normally one of the page's variables. */
  colour: string;
  /** One value per category; null is a gap. */
  values: (number | null)[];
};

export type ChartProps = {
  kind: Kind;
  /** One label per category: the x axis and the readout's heading. */
  categories: string[];
  series: Series[];
  /** Writes a value for an axis tick and the readout. */
  format: (value: number) => string;
  /** The axis titles, drawn beside the axes. */
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
};

const MAX_X_LABELS = 6;

/** The values the value axis must cover: stacks add up, the rest stand alone. */
function axisValues(kind: Kind, series: Series[], count: number): number[] {
  if (kind !== 'stacked')
    return series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  return Array.from({ length: count }, (_, i) =>
    series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
  );
}

export function Chart(props: ChartProps) {
  const { kind, categories, series, format, label, empty, none } = props;
  const [own, setOwn] = useState<number | null>(null);
  const shared = props.at !== undefined;
  const at = shared ? (props.at ?? null) : own;
  const setAt = (next: number | null) => {
    if (!shared) setOwn(next);
    props.onAt?.(next);
  };
  const count = categories.length;
  const values = axisValues(kind, series, count);
  if (count === 0 || values.length === 0) return <p className="empty">{empty}</p>;

  const band = kind === 'bar' || kind === 'stacked' || kind === 'scatter';
  const axis = valueAxis(values, kind !== 'line' && kind !== 'scatter');
  const x = (i: number) => xOfIndex(i, count, band);
  const bandWidth = ((PLOT.right - PLOT.left) / count) * 0.7;
  const baseline = yOf(Math.max(axis.low, 0), axis);

  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const unit = ((event.clientX - box.left) / box.width) * CHART_WIDTH;
    setAt(indexAtPointer(unit, count, band));
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') setAt(null);
    if (step === 0) return;
    event.preventDefault();
    setAt(Math.min(count - 1, Math.max(0, (at ?? (step > 0 ? -1 : count)) + step)));
  };

  const points = (s: Series) =>
    s.values.flatMap((v, i) => (v === null ? [] : [{ x: x(i), y: yOf(v, axis) }]));
  const stackedBase = (i: number, upTo: number) =>
    series.slice(0, upTo).reduce((sum, s) => sum + (s.values[i] ?? 0), 0);

  const readout =
    at === null
      ? ' '
      : [
          categories[at],
          ...series.map((s) => `${s.name} ${s.values[at] == null ? none : format(s.values[at])}`),
        ].join(' · ');

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="group"
        aria-label={label}
        tabIndex={0}
        onPointerMove={pointer}
        onPointerLeave={() => setAt(null)}
        onKeyDown={key}
        onBlur={() => setAt(null)}
      >
        <g className="grid">
          {axis.ticks.map((tick) => (
            <line
              key={tick}
              x1={PLOT.left}
              x2={CHART_WIDTH - PLOT.right}
              y1={yOf(tick, axis)}
              y2={yOf(tick, axis)}
            />
          ))}
        </g>
        <g className="axis y-axis">
          {axis.ticks.map((tick) => (
            <text key={tick} x={PLOT.left - 6} y={yOf(tick, axis)} dy="0.32em" textAnchor="end">
              {format(tick)}
            </text>
          ))}
          {props.yTitle ? (
            <text className="title" x={PLOT.left} y={PLOT.top - 2} textAnchor="start">
              {props.yTitle}
            </text>
          ) : null}
        </g>
        <g className="axis x-axis">
          {labelIndexes(count, MAX_X_LABELS).map((i) => (
            <text key={i} x={x(i)} y={PLOT.bottom + 16} textAnchor="middle">
              {categories[i]}
            </text>
          ))}
          {props.xTitle ? (
            <text
              className="title"
              x={CHART_WIDTH - PLOT.right}
              y={CHART_HEIGHT - 2}
              textAnchor="end"
            >
              {props.xTitle}
            </text>
          ) : null}
        </g>
        {at === null ? null : (
          <line className="crosshair" x1={x(at)} x2={x(at)} y1={PLOT.top} y2={PLOT.bottom} />
        )}
        {kind === 'area'
          ? series.map((s) => {
              const pts = points(s);
              const d = curveAreaSvg(pts, baseline, 'monotone');
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
                const width = bandWidth / series.length;
                const left = x(i) - bandWidth / 2 + n * width;
                const top = Math.min(yOf(v, axis), baseline);
                return (
                  <rect
                    key={`${s.name}-${i}`}
                    className="mark-bar"
                    x={left}
                    y={top}
                    width={Math.max(width - 1, 1)}
                    height={Math.abs(yOf(v, axis) - baseline)}
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
                    y={yOf(below + v, axis)}
                    width={bandWidth}
                    height={yOf(below, axis) - yOf(below + v, axis)}
                    fill={s.colour}
                  />
                );
              })
            )
          : null}
        {kind === 'scatter'
          ? series.flatMap((s) =>
              s.values.map((v, i) =>
                v === null ? null : (
                  <circle
                    key={`${s.name}-${i}`}
                    className={i === props.picked ? 'mark-dot picked' : 'mark-dot'}
                    cx={x(i)}
                    cy={yOf(v, axis)}
                    r={5}
                    fill={s.colour}
                    onClick={() => props.onPick?.(i)}
                  />
                )
              )
            )
          : null}
        {at === null || kind === 'bar' || kind === 'stacked'
          ? null
          : series.map((s) => {
              const v = s.values[at];
              return v == null ? null : (
                <circle
                  key={s.name}
                  className="crosshair-dot"
                  cx={x(at)}
                  cy={yOf(v, axis)}
                  r={4}
                  fill={s.colour}
                />
              );
            })}
      </svg>
      {series.length > 1 || kind === 'stacked' ? (
        <ul className="legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className="swatch" style={{ background: s.colour }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="readout" aria-live="polite">
        {readout}
      </p>
    </figure>
  );
}
