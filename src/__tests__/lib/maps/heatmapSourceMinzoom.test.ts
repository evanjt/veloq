/**
 * Scenario: the engine draws heatmap tiles from zoom 1, and the regional map
 * declares its raster source from zoom 0.
 *
 * Expected behaviour: the source minzoom constant is 0 and the regional source
 * declares it, so a library zoomed out to z1 to z4 still draws its heatmap.
 */

import { buildRegionalSources } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { HEATMAP_SOURCE_MINZOOM } from '@/features/maps/lib/heatmapTiles';

describe('heatmap source minzoom', () => {
  it('is zero', () => {
    expect(HEATMAP_SOURCE_MINZOOM).toBe(0);
  });

  it('matches what the regional source declares', () => {
    const sources = buildRegionalSources({ heatmapEnabled: true } as never);
    expect((sources['heatmap-tiles'] as { minzoom: number }).minzoom).toBe(HEATMAP_SOURCE_MINZOOM);
  });
});
