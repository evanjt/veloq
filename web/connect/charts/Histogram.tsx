// A histogram: the finite values sorted into bins of equal width, drawn as bars
// that touch, with the count on the value axis and the bin's range in the
// tooltip. Given values, a drag bins again over the values it covers; given
// bins already made, it draws those and has nothing to bin again.

import { useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState } from '../ui';
import { ValueGrid, XAxisRow } from './Axes';
import {
  TEXT_PX,
  chartMargins,
  histogramBins,
  type Bin,
  linearX,
  drawingHeight,
  plotBox,
  valueAxis,
  xAxisTicks,
  yOf,
} from './scale';
import { Readout, Tooltip } from './Tooltip';
import { useBrush } from './useBrush';
import { useMeasure, useWidth } from './useSize';

/** What the histogram draws: the values, binned here, or the bins already made. */
type HistogramSource =
  | { values: readonly number[]; bins?: number; binned?: undefined }
  | { binned: readonly Bin[]; values?: undefined; bins?: undefined };

export type HistogramProps = HistogramSource & {
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
  /** Written on the button that undoes a zoom. */
  resetLabel?: string;
};

const DEFAULT_BINS = 12;

export function Histogram(props: HistogramProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const [at, setAt] = useState<number | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const values = props.values ?? [];
  const within = (range: [number, number]) =>
    values.filter((value) => value >= range[0] && value <= range[1]);
  const shown = zoom ? within(zoom) : values;
  const bins: readonly Bin[] = props.binned ?? histogramBins(shown, props.bins ?? DEFAULT_BINS);
  const lowest = bins[0]?.low ?? 0;
  const highest = bins[bins.length - 1]?.high ?? 1;
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
  const brush = useBrush(x, values.length > 1, (next) => {
    if (within(next).length > 0) setZoom(next);
  });
  if (bins.length === 0) return <EmptyState title={props.empty} />;

  const ticks = xAxisTicks({
    kind: 'number',
    domain,
    box,
    measure,
    width,
    format: props.format,
  });
  const baseline = yOf(0, axis, box);
  const pixelOf = (event: PointerEvent<SVGSVGElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const binAt = (px: number) => {
    const value = x.value(px);
    const found = bins.findIndex((bin) => value >= bin.low && value < bin.high);
    return found >= 0 ? found : px >= box.right ? bins.length - 1 : null;
  };
  const bin = at === null || brush.drag ? null : bins[at];
  const text = bin ? props.binText(bin.low, bin.high, bin.count) : ' ';
  const dragLeft = brush.drag ? Math.min(brush.drag.from, brush.drag.to) : 0;
  const dragRight = brush.drag ? Math.max(brush.drag.from, brush.drag.to) : 0;
  const middle = bin ? x.position((bin.low + bin.high) / 2) : 0;
  return (
    <figure className="chart histogram" ref={ref}>
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
          else setAt(binAt(px));
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
        <ValueGrid
          axis={axis}
          box={box}
          format={props.count}
          title={props.yTitle}
          width={width}
          measure={measure}
        />
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
        lines={bin ? [text] : []}
        x={middle}
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
