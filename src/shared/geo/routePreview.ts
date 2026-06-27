export interface PixelPoint {
  x: number;
  y: number;
}

interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Project GPS coordinates into pixel points that fit a width×height box while
 * preserving the route's geographic aspect ratio (longitude compressed by
 * cos(latitude)), centered with padding, north-up. Pure — for a cheap static
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
