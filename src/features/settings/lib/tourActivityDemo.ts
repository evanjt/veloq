/**
 * Fixed demo activities for the tour's pictures of the feed and an activity. They are an
 * illustration, the same for every athlete: an athlete's own activities come from the engine on
 * the screens themselves.
 */

/** One demo activity's track, as turning angles in radians per step, so each draws a shape. */
const DEMO_TURNS: readonly (readonly number[])[] = [
  [0.4, 0.3, -0.2, -0.5, 0.1, 0.6, 0.7, 0.2, -0.3, 0.5, 0.8, 0.4, -0.1, 0.3, 0.6, 0.5],
  [-0.2, 0.1, 0.5, 0.2, -0.6, -0.4, 0.3, 0.6, 0.1, -0.2, 0.4, 0.7, 0.3, 0.2, -0.3, 0.1],
];

/** The number of demo tracks there are, one per demo activity. */
export const DEMO_TRACK_COUNT = DEMO_TURNS.length;

/** Elevation in metres along the demo activity, sampled evenly from start to finish. */
export const DEMO_ELEVATION: readonly number[] = [
  412, 418, 431, 452, 470, 496, 521, 538, 547, 541, 522, 498, 476, 465, 471, 489, 503, 494, 468,
  441, 425, 416,
];

/** The demo activity's hard intervals, as fractions of its length. */
export const DEMO_INTERVALS: readonly { start: number; end: number }[] = [
  { start: 0.18, end: 0.34 },
  { start: 0.62, end: 0.74 },
];

/**
 * The demo track at `index`, as an SVG path fitted inside a `size` square with `pad` clear on
 * every side.
 */
export function demoTrackPath(index: number, size: number, pad: number): string {
  const turns = DEMO_TURNS[index % DEMO_TURNS.length] ?? [];
  let heading = 0;
  let x = 0;
  let y = 0;
  const points = [{ x, y }];
  for (const turn of turns) {
    heading += turn;
    x += Math.cos(heading);
    y += Math.sin(heading);
    points.push({ x, y });
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const fit = (size - pad * 2) / (Math.max(spanX, spanY) || 1);
  // Centre the shorter side, so the track sits in the middle of its square.
  const offsetX = pad + (size - pad * 2 - spanX * fit) / 2;
  const offsetY = pad + (size - pad * 2 - spanY * fit) / 2;
  return points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${offsetX + (p.x - minX) * fit},${offsetY + (p.y - minY) * fit}`
    )
    .join(' ');
}

/**
 * The demo elevation as an SVG path across a `width` by `height` panel, highest point at the top,
 * with `pad` clear on every side. `closed` closes it along the bottom edge, for a filled area.
 */
export function demoElevationPath(
  width: number,
  height: number,
  pad: number,
  closed: boolean
): string {
  const low = Math.min(...DEMO_ELEVATION);
  const range = Math.max(...DEMO_ELEVATION) - low || 1;
  const step = (width - pad * 2) / (DEMO_ELEVATION.length - 1);
  const line = DEMO_ELEVATION.map((metres, i) => {
    const x = pad + i * step;
    const y = height - pad - ((metres - low) / range) * (height - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  return closed ? `${line} L${width - pad},${height - pad} L${pad},${height - pad} Z` : line;
}
