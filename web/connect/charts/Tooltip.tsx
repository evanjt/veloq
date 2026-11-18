// What a chart says about the sample under the pointer: a box beside the
// crosshair, and the same text in a live region for assistive technology, so no
// row is reserved under the plot for it.

import { TOOLTIP_PAD, tooltipLeft, type Measure } from './scale';

export function Tooltip(props: {
  lines: readonly string[];
  /** The crosshair's x in the drawing. */
  x: number;
  /** The plot's left and right edges, which the box stays inside. */
  left: number;
  right: number;
  top: number;
  measure: Measure;
}) {
  if (props.lines.length === 0) return null;
  const width = Math.ceil(Math.max(0, ...props.lines.map(props.measure))) + 2 * TOOLTIP_PAD;
  return (
    <div
      className="chart-tooltip"
      style={{
        left: tooltipLeft(props.x, width, props.left, props.right),
        top: props.top,
        width,
      }}
    >
      {props.lines.map((line, n) => (
        <div key={n}>{line}</div>
      ))}
    </div>
  );
}

/** The sample's text for assistive technology; drawn off-screen. */
export function Readout(props: { text: string }) {
  return (
    <p className="readout" aria-live="polite">
      {props.text}
    </p>
  );
}
