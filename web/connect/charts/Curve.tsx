// A curve over a log axis: power against duration, or time against distance.
// The x axis is logarithmic, ticked on round durations or distances, with the
// crosshair snapping to the sample nearest the pointer and a drag zooming to the
// samples it covers.

import { useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { curveLineSvg } from '@/shared/charts/curvePath';
import { polylineSvgPath } from '@/shared/charts/svgPath';

import { Button, EmptyState } from '../ui';
import { ValueGrid, XAxisRow } from './Axes';
import {
  TEXT_PX,
  categoryTicks,
  chartMargins,
  logTicks,
  logX,
  drawingHeight,
  nearestIndex,
  plotBox,
  valueAxis,
  yOf,
} from './scale';
import { Readout, Tooltip } from './Tooltip';
import { useBrush } from './useBrush';
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
  /** Written on the button that undoes a zoom. */
  resetLabel?: string;
};


export function Curve(props: CurveProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const [at, setAt] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const all = props.xs.flatMap((x, i) => {
    const y = props.ys[i];
    return x > 0 && y !== undefined && Number.isFinite(y) ? [{ x, y }] : [];
  });
  const withIn = (domain: [number, number]) =>
    all.filter((s) => s.x >= domain[0] && s.x <= domain[1]);
  const first = all[0]?.x ?? 1;
  const last = all[all.length - 1]?.x ?? 1;
  const domain = zoom ?? [first, last];
  const samples = withIn(domain);
  const low = samples[0]?.x ?? 1;
  const high = samples[samples.length - 1]?.x ?? 1;
  const axis = valueAxis(samples.map((s) => s.y), false);
  const margins = chartMargins({
    yLabels: axis.ticks.map(props.yFormat),
    measure,
    xTitle: true,
    yTitle: true,
  });
  const height = drawingHeight(width, margins, props.height);
  const box = plotBox(width, height, margins);
  const xScale = logX([low, high], box.left, box.right);
  const brush = useBrush(xScale, all.length > 1, (next) => {
    if (withIn(next).length > 1) setZoom(next);
  });
  if (all.length < 2) return <EmptyState title={props.empty} />;

  const tickValues = logTicks([low, high], props.xTicks);
  const ticks = categoryTicks(
    tickValues.map(props.xFormat),
    tickValues.map(xScale.position),
    width,
    measure,
    box.left
  );
  const points = samples.map((s) => ({ x: xScale.position(s.x), y: yOf(s.y, axis, box) }));
  const d = points.length > 40 ? polylineSvgPath(points) : (curveLineSvg(points, 'monotone') ?? polylineSvgPath(points));
  const pixelOf = (event: PointerEvent<SVGSVGElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const sample = at === null || brush.drag ? null : samples[at];
  const marker = at === null ? undefined : points[at];
  const text = sample ? props.readout(sample.x, sample.y) : ' ';
  const dragLeft = brush.drag ? Math.min(brush.drag.from, brush.drag.to) : 0;
  const dragRight = brush.drag ? Math.max(brush.drag.from, brush.drag.to) : 0;
  return (
    <figure className="chart curve" ref={ref}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fontSize={TEXT_PX}
        role="group"
        aria-label={props.label}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          brush.start(pixelOf(event));
        }}
        onPointerMove={(event) => {
          const px = pixelOf(event);
          if (brush.drag) brush.move(px);
          else setAt(nearestIndex(points.map((p) => p.x), px));
        }}
        onPointerUp={() => {
          brush.end();
        }}
        onPointerCancel={brush.cancel}
        onPointerLeave={() => {
          if (!brush.drag) setAt(null);
        }}
        onDoubleClick={() => setZoom(null)}
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
      <Tooltip
        lines={sample ? [text] : []}
        x={marker?.x ?? 0}
        left={box.left}
        right={box.right}
        top={box.top}
        measure={measure}
      />
      <Readout text={text} />
      {zoom ? (
        <Button size="sm" variant="ghost" onClick={() => setZoom(null)}>
          {props.resetLabel ?? t('connectPage.chart.reset')}
        </Button>
      ) : null}
    </figure>
  );
}
