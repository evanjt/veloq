/**
 * Scenario: the heatmap raster paint was tuned for the 2D map only, and the 3D
 * page carried its own copy of different values. Then the tiles came to be
 * served in each base's own opaque steps, so a paint that shifts or fades
 * them draws colours no base chose.
 *
 * Expected behaviour: for each map style, the built 3D page carries exactly
 * the paint the 2D layer spec emits, and that paint draws the tile's colours
 * as they are.
 */

import { buildMap3DHtml, type Map3DHtmlConfig } from '@/features/maps/lib/htmlBuilders';
import { buildRegionalLayers } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { mapPalette } from '@/theme';
import { heatmapRasterPaint } from '@/features/maps/lib/heatmapPaint';
import type { MapStyleType } from '@/features/maps/components/mapStyles';

const STYLES: MapStyleType[] = ['light', 'dark', 'satellite'];

function html(mapStyle: MapStyleType): string {
  const config: Map3DHtmlConfig = {
    coordinates: [
      [7.447, 46.948],
      [7.449, 46.95],
    ],
    bounds: { sw: [7.447, 46.948], ne: [7.449, 46.95] },
    centerOverride: null,
    zoom: 12,
    bearing: 0,
    pitch: 60,
    hasSavedCamera: false,
    terrainExaggeration: 1.5,
    initStyle: mapStyle,
    mapStyle,
    routeColor: '#FF6B35',
    showHeatmap: true,
    devicePixelRatio: 2,
    reduceMotion: false,
  };
  return buildMap3DHtml(config);
}

describe('heatmap raster paint', () => {
  it.each(STYLES)('3D page paints %s as the 2D layer does', (style) => {
    const layers = buildRegionalLayers({
      palette: mapPalette(style),
      heatmapEnabled: true,
      showHeatmap: true,
      hasSpider: false,
      showActivities: true,
      selectedActivityId: null,
      selectedSectionId: null,
      routeColor: '#FF6B35',
    } as unknown as Parameters<typeof buildRegionalLayers>[0]);
    const twoD = layers.find((l) => l.id === 'heatmap-layer')?.paint;
    expect(twoD).toEqual(heatmapRasterPaint());
    expect(html(style)).toContain(JSON.stringify(heatmapRasterPaint()));
  });

  it('draws the tile colours unchanged and opaque', () => {
    const paint = heatmapRasterPaint();
    expect(paint['raster-opacity']).toBe(1);
    for (const shift of [
      'raster-hue-rotate',
      'raster-brightness-min',
      'raster-brightness-max',
      'raster-saturation',
      'raster-contrast',
    ]) {
      expect(paint).not.toHaveProperty(shift);
    }
  });
});
