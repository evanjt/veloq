// A histogram: the finite values sorted into bins of equal width, drawn as bars
// that touch, with the count on the value axis and the bin's range in the
// readout.

import { useRef, useState, type PointerEvent } from 'react';

import { ValueGrid, XAxisRow } from './Axes';
import {
  TEXT_PX,
  chartMargins,
  histogramBins,
  linearX,
  drawingHeight,
  plotBox,
  valueAxis,
  xAxisTicks,
  yOf,
} from './scale';
import { useMeasure, useWidth } from './useSize';

export type HistogramProps = {
  values: readonly number[];
  bins?: number;
  /** Writes a value at an edge of a bin. */
  format: (value: number) => string;
  /** Writes a count for the value axis. */
  count: (n: number) => string;
  /** The readout's text for a bin. */
  binText: (low: number, high: number, n: number) => string;
  xTitle: string;
  yTitle: string;
  colour: string;
  label: string;
  empty: string;
  width?: number;
  height?: number;
};

const DEFAULT_BINS = 12;

export function Histogram(props: HistogramProps) {
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const [at, setAt] = useState<number | null>(null);
  const bins = histogramBins(props.values, props.bins ?? DEFAULT_BINS);
  const lowest = bins[0]?.low;
  const highest = bins[bins.length - 1]?.high;
  if (lowest === undefined || highest === undefined) return <p className="empty">{props.empty}</p>;

  const axis = valueAxis(
    bins.map((bin) => bin.count),
    true
  );
  const margins = chartMargins({
    yLabels: axis.ticks.map(props.count),
    measure,
    xTitle: true,
    yTitle: true,
  });
  const height = drawingHeight(width, margins, props.height);
  const box = plotBox(width, height, margins);
  const domain: [number, number] = [lowest, highest];
  const x = linearX(domain, box.left, box.right);
  const ticks = xAxisTicks({
    kind: 'number',
    domain,
    box,
    measure,
    width,
    format: props.format,
  });
  const baseline = yOf(0, axis, box);
  const pointer = (event: PointerEvent<SVGSVGElement>) => {
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const value = x.value(px);
    const found = bins.findIndex((bin) => value >= bin.low && value < bin.high);
    setAt(found >= 0 ? found : px >= box.right ? bins.length - 1 : null);
  };
  const bin = at === null ? null : bins[at];
  return (
    <figure className="chart histogram" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fontSize={TEXT_PX}
        role="group"
        aria-label={props.label}
        onPointerMove={pointer}
        onPointerLeave={() => setAt(null)}
      >
        <ValueGrid axis={axis} box={box} format={props.count} title={props.yTitle} width={width} measure={measure} />
        <XAxisRow ticks={ticks} box={box} title={props.xTitle} measure={measure} />
        {bins.map((b, i) => (
          <rect
            key={b.low}
            className="mark-bar"
            x={x.position(b.low) + 0.5}
            y={yOf(b.count, axis, box)}
            width={Math.max(x.position(b.high) - x.position(b.low) - 1, 1)}
            height={baseline - yOf(b.count, axis, box)}
            fill={props.colour}
            opacity={i === at ? 1 : 0.85}
          />
        ))}
      </svg>
      <p className="readout" aria-live="polite">
        {bin ? props.binText(bin.low, bin.high, bin.count) : ' '}
      </p>
    </figure>
  );
}
