/**
 * Scenario: the live catalogue drawn under a preview diff.
 * Expected behaviour: it is the baseline of the whole comparison, so it has to
 * be legible over whatever basemap is under it, while still reading as
 * subordinate to the proposed lines above it. Subordinate is carried by width
 * and dashing, never by an opacity that makes the line disappear.
 */

import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { mapLayerColors, mapPalette } from '@/theme';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
const layers = buildPreviewLayers(mapPalette('light'), false, true);
const byId = (id: string) => layers.find((l) => l.id === id);

describe('the current-catalogue layer', () => {
  it('draws at an opacity that can be seen', () => {
    expect(byId('current-line')?.paint?.['line-opacity']).toBeGreaterThanOrEqual(0.9);
  });

  it('carries a white casing beneath it, as every other coloured line here does', () => {
    const casing = byId('current-casing');

    expect(casing?.source).toBe('current-sections');
    expect(casing?.paint?.['line-color']).toBe(mapLayerColors.casing);
    expect(layers.findIndex((l) => l.id === 'current-casing')).toBeLessThan(
      layers.findIndex((l) => l.id === 'current-line')
    );
    expect(casing?.paint?.['line-width']).toBeGreaterThan(
      byId('current-line')?.paint?.['line-width'] as number
    );
  });

  it('stays subordinate to the proposed lines by weight, not by fading out', () => {
    const current = byId('current-line')?.paint;
    const proposed = byId('proposed-line')?.paint;

    expect(current?.['line-width']).toBeLessThan(proposed?.['line-width'] as number);
    expect(current?.['line-dasharray']).toBeDefined();
    expect(proposed?.['line-dasharray']).toBeUndefined();
  });

  it('keeps the casing out of the tappable layers', () => {
    const {
      PREVIEW_INTERACTIVE_LAYERS,
    } = require('@/features/routes/components/preview/previewMapLayerSpecs');

    expect(PREVIEW_INTERACTIVE_LAYERS).not.toContain('current-casing');
    expect(PREVIEW_INTERACTIVE_LAYERS).toContain('current-line');
  });
});

/**
 * Scenario: the retired screen sets retired sections against the catalogue that replaced them.
 * Expected behaviour: the two kinds of line differ in colour on every base, in the comparison
 * the current line is solid and the retired one dashed, and a line the selection is not about
 * steps back, so the athlete can read which line is which.
 */
describe('the old-versus-new lines', () => {
  const bases = ['light', 'dark', 'satellite'] as const;
  const {
    previewLayerSwatch,
  } = require('@/features/routes/components/preview/previewMapLayerSpecs');

  it.each(bases)('keys retired and current apart on the %s base', (base) => {
    const palette = mapPalette(base);
    expect(previewLayerSwatch('retired-line', palette)).not.toBe(
      previewLayerSwatch('current-line', palette)
    );
    expect(previewLayerSwatch('retired-line', palette, true)).not.toBe(
      previewLayerSwatch('current-line', palette, true)
    );
  });

  it.each(bases)('draws current solid and retired dashed in the comparison on %s', (base) => {
    const palette = mapPalette(base);
    const compared = buildPreviewLayers(palette, true);
    const current = compared.find((l) => l.id === 'current-line');
    const retired = compared.find((l) => l.id === 'retired-line');

    expect(current?.paint?.['line-dasharray']).toBeUndefined();
    expect(retired?.paint?.['line-dasharray']).toBeDefined();
    expect(current?.paint?.['line-color']).not.toBe(palette.layer.current);
    expect(current?.paint?.['line-color']).not.toBe(retired?.paint?.['line-color']);
  });

  it('dims a current line the selection is not about', () => {
    const current = buildPreviewLayers(mapPalette('dark'), true).find(
      (l) => l.id === 'current-line'
    );
    expect(JSON.stringify(current?.paint?.['line-opacity'])).toContain('"other"');
  });
});
