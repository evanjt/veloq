import type { MapStyleType } from '@/features/maps/components/mapStyles';

/**
 * The raster paint of the heatmap layer, for every surface that draws it.
 *
 * The tile ramp rises in lightness with density, which on a light basemap would
 * draw the densest ground palest. The light map rotates the hue by 180 degrees
 * and maps lightness onto a brightness range that falls from .3 to 0, so the
 * ramp darkens with density and keeps its teal hue. The faintest stops composite
 * at 3:1 or better against every light ground, and the faintest to the densest
 * at 3:1 or better over land. The 2D map and both 3D scripts read this one
 * function, so a retune lands on all three.
 */
export function heatmapRasterPaint(mapStyle: MapStyleType): Record<string, number | string> {
  const isLight = mapStyle === 'light';
  return {
    'raster-opacity': isLight ? 1 : 0.72,
    'raster-contrast': 0,
    ...(isLight && {
      'raster-hue-rotate': 180,
      'raster-brightness-min': 0.3,
    }),
    'raster-brightness-max': isLight ? 0 : 1,
    'raster-saturation': 0,
    'raster-resampling': 'linear',
    'raster-fade-duration': 0,
  };
}

type Rgba = readonly [number, number, number, number];

/**
 * The colour stops the engine paints heatmap tiles with, as intensity and RGBA
 * bytes, faintest first. The transparent zero stop is left out: nothing is drawn
 * there. A contract test holds this to the engine's own table.
 */
export const HEATMAP_TILE_STOPS: readonly { intensity: number; rgba: Rgba }[] = [
  { intensity: 0.04, rgba: [13, 148, 136, 176] },
  { intensity: 0.14, rgba: [16, 163, 150, 190] },
  { intensity: 0.32, rgba: [20, 184, 166, 205] },
  { intensity: 0.58, rgba: [45, 212, 191, 220] },
  { intensity: 0.8, rgba: [94, 234, 212, 232] },
  { intensity: 0.94, rgba: [153, 246, 228, 242] },
  { intensity: 1, rgba: [204, 251, 241, 248] },
];

/**
 * The heatmap's stops as the layer draws them over `ground`, faintest first, for
 * the ramp that keys it. Each stop goes through the raster paint the way the GL
 * raster shader applies it: hue rotation, then lightness mapped onto the
 * brightness range, then the tile alpha times the layer opacity over the ground.
 * Saturation and contrast are neutral in every style's paint.
 */
export function heatmapKeyColours(mapStyle: MapStyleType, ground: string): string[] {
  const paint = heatmapRasterPaint(mapStyle);
  const angle = (((paint['raster-hue-rotate'] as number | undefined) ?? 0) * Math.PI) / 180;
  const low = (paint['raster-brightness-min'] as number | undefined) ?? 0;
  const high = (paint['raster-brightness-max'] as number | undefined) ?? 1;
  const opacity = (paint['raster-opacity'] as number | undefined) ?? 1;
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
  const w0 = (2 * cos + 1) / 3;
  const w1 = (-Math.sqrt(3) * sin - cos + 1) / 3;
  const w2 = (Math.sqrt(3) * sin - cos + 1) / 3;
  const byte = (at: number) => parseInt(ground.slice(at, at + 2), 16);
  const under = [byte(1), byte(3), byte(5)] as const;

  return HEATMAP_TILE_STOPS.map(({ rgba: [red, green, blue, a] }) => {
    const [r, g, b] = [red / 255, green / 255, blue / 255];
    const rotated = [
      r * w0 + g * w1 + b * w2,
      r * w2 + g * w0 + b * w1,
      r * w1 + g * w2 + b * w0,
    ] as const;
    const alpha = (a / 255) * opacity;
    const channel = (value: number, beneath: number) => {
      const painted = Math.min(1, Math.max(0, low + (high - low) * value));
      const over = Math.round(painted * 255 * alpha + beneath * (1 - alpha));
      return over.toString(16).padStart(2, '0');
    };
    return `#${channel(rotated[0], under[0])}${channel(rotated[1], under[1])}${channel(rotated[2], under[2])}`;
  });
}
