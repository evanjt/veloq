// The parts every chart kind draws the same way: the grid and value labels, the
// x tick row, and the titles. Text is 12 px tabular, placed by the scale module
// from measured widths, and cut to the room it has, so no label leaves the
// drawing.

import {
  TEXT_PX,
  TICK_ROW,
  X_TITLE_ROW,
  Y_TITLE_RISE,
  fitText,
  yOf,
  type Box,
  type Measure,
  type ValueAxis,
} from './scale';

/** The gap between an inline title and the plot's edges. */
const INLINE_INSET = 6;

type XTick = { label: string; left: number };

export function ValueGrid(props: {
  axis: ValueAxis;
  box: Box;
  format: (value: number) => string;
  title?: string | undefined;
  /** Writes the title inside the plot at its top left, not in a row above it. */
  inline?: boolean;
  width: number;
  measure: Measure;
}) {
  const { axis, box } = props;
  return (
    <>
      <rect
        className="plot"
        x={box.left}
        y={box.top}
        width={box.right - box.left}
        height={box.bottom - box.top}
        fill="none"
        pointerEvents="none"
      />
      <g className="grid">
        {axis.ticks.map((tick) => (
          <line key={tick} x1={box.left} x2={box.right} y1={yOf(tick, axis, box)} y2={yOf(tick, axis, box)} />
        ))}
      </g>
      <g className="axis y-axis">
        {axis.ticks.map((tick) => (
          <text key={tick} x={box.left - 6} y={yOf(tick, axis, box)} dy="0.32em" textAnchor="end">
            {props.format(tick)}
          </text>
        ))}
        {props.title && props.inline ? (
          <text className="title" x={box.left + INLINE_INSET} y={box.top + TEXT_PX + INLINE_INSET} textAnchor="start">
            {fitText(props.title, box.right - box.left - 2 * INLINE_INSET, props.measure)}
          </text>
        ) : props.title ? (
          <text className="title" x={0} y={box.top - Y_TITLE_RISE} textAnchor="start">
            {fitText(props.title, props.width, props.measure)}
          </text>
        ) : null}
      </g>
    </>
  );
}

export function XAxisRow(props: {
  ticks: readonly XTick[];
  box: Box;
  title?: string | undefined;
  /** Draw the tick labels; a lane in a stack leaves them to the last lane. */
  labels?: boolean;
  measure: Measure;
}) {
  const { box } = props;
  const row = box.bottom + TICK_ROW;
  return (
    <g className="axis x-axis">
      {props.labels === false
        ? null
        : props.ticks.map((tick) => (
            <text key={`${tick.left}-${tick.label}`} x={tick.left} y={row} textAnchor="start">
              {tick.label}
            </text>
          ))}
      {props.title ? (
        <text className="title" x={box.right} y={box.bottom + X_TITLE_ROW} textAnchor="end">
          {fitText(props.title, box.right, props.measure)}
        </text>
      ) : null}
    </g>
  );
}
