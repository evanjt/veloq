import { mapLayerColors, mapPalette } from '@/theme';
import type { MapBase } from '@/theme';
import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { homeRadiusLayers } from '@/features/maps/lib/homeRadiusLayers';
import { groupingLayerPaint } from '@/features/routes/lib/groupingLegend';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const bases: MapBase[] = ['light', 'dark', 'satellite'];

describe('map casing', () => {
  it('is not a literal colour beside the palette role', () => {
    expect(Object.keys(mapLayerColors)).not.toContain('casing');
  });

  it.each(bases)('draws every casing layer from the %s base role', (base) => {
    const palette = mapPalette(base);
    const casings = buildPreviewLayers(palette, false, true).filter((l) =>
      l.id.endsWith('-casing')
    );
    expect(casings.length).toBeGreaterThan(0);
    for (const casing of casings) {
      expect(casing.paint?.['line-color']).toBe(palette.casing);
    }
  });

  it.each(bases)('draws the home stroke and dropped sections from the %s base role', (base) => {
    const palette = mapPalette(base);
    const home = homeRadiusLayers(palette).find((l) => l.id === 'home-point');
    expect(home?.paint?.['circle-stroke-color']).toBe(palette.casing);
    expect(groupingLayerPaint(palette).dropped.colour).toBe(palette.casing);
  });

  it.each(bases)('draws the preview area outline from the %s base role', (base) => {
    const palette = mapPalette(base);
    const outline = buildPreviewLayers(palette, false, true).find(
      (l) => l.id === 'preview-area-line'
    );
    expect(outline?.paint?.['line-color']).toBe(palette.casing);
  });
});
