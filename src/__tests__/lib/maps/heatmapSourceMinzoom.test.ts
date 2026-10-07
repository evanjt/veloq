/**
 * Scenario: the engine draws heatmap tiles from zoom 1, and the regional map
 * declares its raster source from zoom 0.
 *
 * Expected behaviour: the 3D page declares the same source minzoom, so a
 * library zoomed out to z1 to z4 still draws its heatmap in 3D.
 */

import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders';
import { buildRegionalSources } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { HEATMAP_SOURCE_MINZOOM } from '@/features/maps/lib/heatmapTiles';

describe('heatmap source minzoom', () => {
  it('is zero on the 3D page, as on the regional map', () => {
    const html = buildMap3DHtml({
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
      initStyle: 'light',
      mapStyle: 'light',
      routeColor: '#FF6B35',
      showHeatmap: true,
      devicePixelRatio: 2,
    });
    const source = html.match(/addSource\('heatmap-tiles',\s*\{[\s\S]*?minzoom:\s*(\d+)/);
    expect(source?.[1]).toBe(String(HEATMAP_SOURCE_MINZOOM));
    expect(HEATMAP_SOURCE_MINZOOM).toBe(0);
  });

  it('matches what the regional source declares', () => {
    const sources = buildRegionalSources({ heatmapEnabled: true } as never);
    expect((sources['heatmap-tiles'] as { minzoom: number }).minzoom).toBe(HEATMAP_SOURCE_MINZOOM);
  });
});
