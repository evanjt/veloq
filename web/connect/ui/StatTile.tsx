// A figure with its label, an optional change against a comparison and an optional sparkline,
// and the strip that lays the tiles of a page side by side.

import type { ReactNode } from 'react';

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 32;
const MINUS = '−';

/** The points of a polyline for a series scaled into the sparkline's box; empty below two points. */
export function sparkPoints(series: readonly number[]): string {
  if (series.length < 2) return '';
  const low = Math.min(...series);
  const span = Math.max(...series) - low || 1;
  return series
    .map((value, at) => {
      const x = (at / (series.length - 1)) * SPARK_WIDTH;
      const y = SPARK_HEIGHT - ((value - low) / span) * SPARK_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export type StatDelta = {
  /** The change since the comparison, in the figure's own unit. */
  change: number;
  /** What the change is against, such as "vs last week". */
  label: string;
};

function deltaText(change: number) {
  const shown = Math.abs(change).toFixed(1);
  if (Number(shown) === 0) return { trend: 'flat', text: shown };
  return change > 0
    ? { trend: 'up', text: `+${shown}` }
    : { trend: 'down', text: `${MINUS}${shown}` };
}

export function StatTile(props: {
  label: string;
  value: string | null;
  delta?: StatDelta | undefined;
  /** A note under the figure when there is no sparkline. */
  note?: string | undefined;
  spark?: readonly number[] | undefined;
  sparkLabel?: string | undefined;
  /** A drawn trend that replaces the built-in sparkline. */
  trend?: ReactNode;
}) {
  const delta = props.delta ? deltaText(props.delta.change) : null;
  const points = props.spark ? sparkPoints(props.spark) : '';
  return (
    <div className="ui-stat-tile">
      <p className="ui-stat-label" data-part="label">
        {props.label}
      </p>
      <p className="ui-stat-value" data-part="value">
        {props.value ?? '–'}
      </p>
      {props.delta && delta ? (
        <p className="ui-stat-delta" data-trend={delta.trend}>
          {delta.text} {props.delta.label}
        </p>
      ) : null}
      {props.trend ? (
        props.trend
      ) : points ? (
        <svg
          className="ui-stat-spark"
          viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
          role="img"
          aria-label={props.sparkLabel}
        >
          <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
        </svg>
      ) : props.note ? (
        <p className="ui-stat-note">{props.note}</p>
      ) : null}
    </div>
  );
}

/** Four to eight tiles in one row, wrapping as the page narrows. */
export function StatStrip(props: { children: ReactNode; id?: string; label: string }) {
  const tiles = Array.isArray(props.children) ? props.children : [props.children];
  return (
    <ul id={props.id} className="ui-stat-strip" aria-label={props.label}>
      {tiles.filter(Boolean).map((tile, at) => (
        <li key={at}>{tile}</li>
      ))}
    </ul>
  );
}
