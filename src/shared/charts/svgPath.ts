/**
 * SVG path-string builders for Skia's supported `Skia.Path.MakeFromSVGString`
 * constructor.
 *
 * The imperative `Skia.Path.Make().moveTo()/lineTo()/cubicTo()` API is deprecated
 * in react-native-skia 2.x and a path built that way fails to paint in the
 * declarative <Path> tree on Android (it silently blanks the whole Canvas). Build
 * the "d" string and parse it instead - the method the SummaryCard sparkline has
 * always used, which is why it kept rendering across the SDK 56 Skia bump.
 */

export interface XY {
  x: number;
  y: number;
}

/** Open polyline: "M x y L x y …". Returns '' for an empty input. */
export function polylineSvgPath(points: XY[]): string {
  if (points.length === 0) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += `L${points[i].x} ${points[i].y}`;
  return d;
}

/**
 * Closed confidence band: upper edge forward, lower edge backward, then closed.
 * `upper` and `lower` align by index. Returns '' if either is empty.
 */
export function bandSvgPath(upper: XY[], lower: XY[]): string {
  if (upper.length === 0 || lower.length === 0) return '';
  let d = `M${upper[0].x} ${upper[0].y}`;
  for (let i = 1; i < upper.length; i++) d += `L${upper[i].x} ${upper[i].y}`;
  for (let i = lower.length - 1; i >= 0; i--) d += `L${lower[i].x} ${lower[i].y}`;
  return `${d}Z`;
}
