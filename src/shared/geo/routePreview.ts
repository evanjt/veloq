export interface PixelPoint {
  x: number;
  y: number;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Project GPS coordinates into pixel points that fit a width×height box while
 * preserving the route's geographic aspect ratio (longitude compressed by
 * cos(latitude)), centered with padding, north-up. Pure - for a cheap static
 * route preview drawn with Skia (no live map / GL context). Returns [] when
 * there is nothing to draw.
 */
export function projectRouteToBox(
  coords: LatLng[],
  width: number,
  height: number,
  pad = 8
): PixelPoint[] {
  if (coords.length < 2 || width <= 0 || height <= 0) return [];

  const centerLat = coords.reduce((sum, c) => sum + c.latitude, 0) / coords.length;
  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;

  const xs = coords.map((c) => c.longitude * cosLat);
  const ys = coords.map((c) => c.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;

  const boxW = Math.max(1, width - pad * 2);
  const boxH = Math.max(1, height - pad * 2);
  const scale = Math.min(boxW / spanX, boxH / spanY);

  const offX = pad + (boxW - spanX * scale) / 2;
  const offY = pad + (boxH - spanY * scale) / 2;

  return coords.map((_c, i) => ({
    x: offX + (xs[i] - minX) * scale,
    y: offY + (maxY - ys[i]) * scale, // invert Y so north is up
  }));
}

/**
 * Normalised route outline, so a surface with no map can still draw the shape of a
 * ride. Points are 0..1 [x, y] pairs, y growing downward like screen pixels.
 */
export interface RouteOutline {
  points: [number, number][];
  /** Projected bounding-box width divided by height, for letterboxed drawing. */
  aspect: number;
}

export const ROUTE_OUTLINE_MAX_POINTS = 150;

/**
 * Project and normalise a GPS track into a 0..1 drawing box. Equirectangular
 * projection (x scaled by cos of the mid latitude) keeps the shape visually
 * faithful at route scale; y is flipped so it grows downward like screen pixels.
 *
 * Both callers draw without a basemap and under a byte budget: the home-screen
 * widget snapshot, and the Live Activity payload ActivityKit caps at 4 KB.
 */
export function composeRouteOutline(
  gps: LatLng[] | null | undefined,
  maxPoints = ROUTE_OUTLINE_MAX_POINTS
): RouteOutline | null {
  if (!gps || gps.length < 2) return null;

  const stride = Math.max(1, Math.ceil(gps.length / maxPoints));
  const sampled: LatLng[] = [];
  for (let i = 0; i < gps.length; i += stride) {
    const p = gps[i];
    if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) sampled.push(p);
  }
  const last = gps[gps.length - 1];
  if (
    sampled.length > 0 &&
    sampled[sampled.length - 1] !== last &&
    Number.isFinite(last.latitude) &&
    Number.isFinite(last.longitude)
  ) {
    sampled.push(last);
  }
  if (sampled.length < 2) return null;

  const midLat = (sampled[0].latitude + sampled[sampled.length - 1].latitude) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const projected = sampled.map((p) => {
    const x = p.longitude * lonScale;
    const y = p.latitude;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    return { x, y };
  });

  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) && !(h > 0)) return null;
  const safeW = w > 0 ? w : 1;
  const safeH = h > 0 ? h : 1;

  const points: [number, number][] = projected.map((p) => [
    round3((p.x - minX) / safeW),
    round3(1 - (p.y - minY) / safeH),
  ]);
  const aspect = h > 0 ? Math.max(0.1, Math.min(10, w / h)) : 1;
  return { points, aspect: Math.round(aspect * 100) / 100 };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
