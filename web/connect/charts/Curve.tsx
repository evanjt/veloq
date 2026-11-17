// A curve over a log axis: power against duration, or time against distance.
// The x axis is logarithmic, ticked on round durations or distances, with the
// crosshair snapping to the sample nearest the pointer.

import { useRef, useState, type PointerEvent } from 'react';

import { curveLineSvg } from '@/shared/charts/curvePath';
import { polylineSvgPath } from '@/shared/charts/svgPath';

import { ValueGrid, XAxisRow } from './Axes';
import {
  TEXT_PX,
  categoryTicks,
  chartMargins,
  logFraction,
  logTicks,
  drawingHeight,
  plotBox,
  valueAxis,
  yOf,
} from './scale';
import { useMeasure, useWidth } from './useSize';

export type CurveProps = {
  /** The x of each sample, positive and increasing: seconds or metres. */
  xs: readonly number[];
  ys: readonly number[];
  /** The round values the x axis may tick on. */
  xTicks: readonly number[];
  xFormat: (value: number) => string;
  yFormat: (value: number) => string;
  xTitle: string;
  yTitle: string;
  colour: string;
  label: string;
  empty: string;
  /** The reading under the crosshair. */
  readout: (x: number, y: number) => string;
  width?: number;
  height?: number;
};


export function Curve(props: CurveProps) {
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const [at, setAt] = useState<number | null>(null);
  const samples = props.xs.flatMap((x, i) => {
    const y = props.ys[i];
    return x > 0 && y !== undefined && Number.isFinite(y) ? [{ x, y }] : [];
  });
  const low = samples[0]?.x;
  const high = samples[samples.length - 1]?.x;
  if (samples.length < 2 || low === undefined || high === undefined) {
    return <p className="empty">{props.empty}</p>;
  }
  const axis = valueAxis(samples.map((s) => s.y), false);
  const margins = chartMargins({
    yLabels: axis.ticks.map(props.yFormat),
    measure,
    xTitle: true,
    yTitle: true,
  });
  const height = drawingHeight(width, margins, props.height);
  const box = plotBox(width, height, margins);
  const px = (x: number) => box.left + logFraction(x, low, high) * (box.right - box.left);
  const tickValues = logTicks([low, high], props.xTicks);
  const ticks = categoryTicks(
    tickValues.map(props.xFormat),
    tickValues.map(px),
    width,
    measure,
    box.left
  );
  const points = samples.map((s) => ({ x: px(s.x), y: yOf(s.y, axis, box) }));
  const d = points.length > 40 ? polylineSvgPath(points) : (curveLineSvg(points, 'monotone') ?? polylineSvgPath(points));
  const nearest = (pixel: number) => {
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.x - pixel) < Math.abs((points[best]?.x ?? Infinity) - pixel)) best = i;
    });
    return best;
  };
  const pointer = (event: PointerEvent<SVGSVGElement>) =>
    setAt(nearest(event.clientX - event.currentTarget.getBoundingClientRect().left));
  const sample = at === null ? null : samples[at];
  const marker = at === null ? undefined : points[at];
  return (
    <figure className="chart curve" ref={ref}>
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
        <ValueGrid axis={axis} box={box} format={props.yFormat} title={props.yTitle} width={width} measure={measure} />
        <XAxisRow ticks={ticks} box={box} title={props.xTitle} measure={measure} />
        <path className="mark-line" d={d} fill="none" stroke={props.colour} />
        {sample && marker ? (
          <>
            <line className="crosshair" x1={marker.x} x2={marker.x} y1={box.top} y2={box.bottom} />
            <circle className="crosshair-dot" cx={marker.x} cy={marker.y} r={4} fill={props.colour} />
          </>
        ) : null}
      </svg>
      <p className="readout" aria-live="polite">
        {sample ? props.readout(sample.x, sample.y) : ' '}
      </p>
    </figure>
  );
}
