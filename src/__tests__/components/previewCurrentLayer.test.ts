/**
 * Scenario: the live catalogue drawn under a preview diff.
 * Expected behaviour: it is the baseline of the whole comparison, so it has to
 * be legible over whatever basemap is under it, while still reading as
 * subordinate to the proposed lines above it. Subordinate is carried by width
 * and dashing, never by an opacity that makes the line disappear.
 */

import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { mapLayerColors } from '@/theme';

const layers = buildPreviewLayers();
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
