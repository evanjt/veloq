// The faint line layer behind a store composite. The lines are the demo
// library's own GPS tracks, projected into the canvas, never drawn by hand.
import { demoRoutes, type DemoRoute } from '@/shared/demo/routes/routes';

export interface TrackLine {
  routeId: string;
  /** Canvas pixels, north up. */
  points: [number, number][];
}

export interface TrackLayer {
  width: number;
  height: number;
  lines: TrackLine[];
}

const LINE_COUNT = 9;
const MIN_FIXES = 100;
const MAX_POINTS = 140;
// A track fills this share of its cell, so neighbours do not touch.
const CELL_FILL = 0.82;
const COLUMNS = 3;
const ON_FOOT_OR_WHEELS: DemoRoute['type'][] = ['Ride', 'Run', 'Hike', 'VirtualRide'];

function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)] as T);
}

// Equirectangular, scaled by cos(latitude) so a track keeps its shape.
function project(route: DemoRoute, cell: { x: number; y: number; w: number; h: number }) {
  const coords = sample(route.coordinates, MAX_POINTS);
  const lats = coords.map((c) => c[0]);
  const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const k = Math.cos((meanLat * Math.PI) / 180);
  const xs = coords.map((c) => c[1] * k);
  const minX = Math.min(...xs);
  const maxLat = Math.max(...lats);
  const spanX = Math.max(...xs) - minX;
  const spanY = maxLat - Math.min(...lats);
  const scale = (CELL_FILL * Math.min(cell.w, cell.h)) / Math.max(spanX, spanY, Number.EPSILON);
  const offX = cell.x + (cell.w - spanX * scale) / 2;
  const offY = cell.y + (cell.h - spanY * scale) / 2;
  return coords.map((c, i): [number, number] => [
    Math.round(offX + ((xs[i] ?? 0) - minX) * scale),
    Math.round(offY + (maxLat - c[0]) * scale),
  ]);
}

/**
 * The demo library's first tracks by id, one per cell of a grid over the
 * canvas. Deterministic: the same canvas always draws the same lines.
 */
export function trackLayer(width: number, height: number): TrackLayer {
  const rows = Math.ceil(LINE_COUNT / COLUMNS);
  const cell = { w: width / COLUMNS, h: height / rows };
  const routes = demoRoutes
    .filter((r) => ON_FOOT_OR_WHEELS.includes(r.type) && r.coordinates.length >= MIN_FIXES)
    .sort((a, b) => a.id.localeCompare(b.id));
  const lines = routes.slice(0, LINE_COUNT).map((route, i): TrackLine => ({
    routeId: route.id,
    points: project(route, {
      x: (i % COLUMNS) * cell.w,
      y: Math.floor(i / COLUMNS) * cell.h,
      w: cell.w,
      h: cell.h,
    }),
  }));
  return { width, height, lines };
}

export function trackSvg(layer: TrackLayer, stroke: string, strokeWidth: number): string {
  const paths = layer.lines
    .map(
      (l) =>
        `<polyline points="${l.points.map((p) => p.join(',')).join(' ')}" fill="none" ` +
        `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('');
  return `<svg class="tracks" width="${layer.width}" height="${layer.height}">${paths}</svg>`;
}
