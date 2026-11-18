// A small line drawn at the width its element measures, with no axes: a trend
// in a card, or two rates on one scale. It is drawn at its own size, never
// stretched from a fixed box, so its stroke and its marker keep their shape.

import { useRef } from 'react';

import { sparkPoints, type SparkRange } from './scale';
import { useWidth } from './useSize';

const INSET = 2;

export type SparklineProps = {
  lines: readonly { values: readonly number[]; className?: string }[];
  /** `fit` spans the lowest to the highest value drawn; `zero` runs from zero. */
  range: 'fit' | 'zero';
  height: number;
  /** Class of the element the width is measured on; the page's stylesheet sizes it. */
  className?: string;
  /** Names the drawing for assistive technology; without it the drawing is hidden from it. */
  label?: string;
  /** One point of one line to mark. */
  marker?: { line: number; index: number };
  /** Draws at this width rather than measuring one; for a drawing made without a browser. */
  width?: number;
};

function rangeOf(lines: SparklineProps['lines'], mode: SparklineProps['range']): SparkRange {
  const all = lines.flatMap((line) => line.values.filter(Number.isFinite));
  const high = all.length ? Math.max(...all) : 0;
  if (mode === 'zero') return { low: 0, high: high > 0 ? high : 1 };
  return { low: all.length ? Math.min(...all) : 0, high };
}

export function Sparkline(props: SparklineProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const width = useWidth(ref, props.width);
  const range = rangeOf(props.lines, props.range);
  const drawn = props.lines.map((line) =>
    sparkPoints(line.values, width, props.height, range, INSET)
  );
  const mark = props.marker ? drawn[props.marker.line]?.[props.marker.index] : undefined;
  return (
    <span className={props.className} ref={ref} style={{ display: 'block' }}>
      <svg
        width={width}
        height={props.height}
        viewBox={`0 0 ${width} ${props.height}`}
        {...(props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': true })}
      >
        {props.lines.map((line, n) => (
          <polyline
            key={n}
            className={line.className}
            fill="none"
            points={
              line.values.length < 2
                ? ''
                : (drawn[n] ?? []).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
            }
          />
        ))}
        {mark ? <circle cx={mark.x} cy={mark.y} r={2.5} /> : null}
      </svg>
    </span>
  );
}
