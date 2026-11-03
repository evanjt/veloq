/**
 * Scenario: the colours a diff run draws and the key that explains them.
 * Expected behaviour: the key lists the diff strip's four categories, each swatch is the colour
 * its lines are drawn in, unchanged differs from changed, and a category with no sections is
 * not listed. Before a run the key is the current catalogue alone.
 */

import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';
import { buildPreviewKey } from '@/features/routes/components/preview/previewKey';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const palette = mapPalette('light');
const FULL = { unchanged: 20, changed: 4, new: 2, gone: 3 };

function proposedColourFor(status: string): string {
  const colour = buildPreviewLayers(palette, false, true).find((l) => l.id === 'proposed-line')
    ?.paint?.['line-color'] as unknown[];
  // ['match', ['get', 'status'], a, colourA, b, colourB, fallback]
  const at = colour.indexOf(status);
  return (at === -1 ? colour[colour.length - 1] : colour[at + 1]) as string;
}

describe('the preview key', () => {
  it('lists all four categories after a run, each in the colour its lines are drawn in', () => {
    const key = buildPreviewKey(FULL, palette, true);

    for (const status of ['unchanged', 'changed', 'new'] as const) {
      expect(key.find((e) => e.id === status)?.swatch).toBe(proposedColourFor(status));
    }
    expect(key.find((e) => e.id === 'gone')?.swatch).toBe(
      buildPreviewLayers(palette, false, true).find((l) => l.id === 'gone-line')?.paint?.[
        'line-color'
      ]
    );
  });

  it('draws unchanged sections apart from changed ones', () => {
    expect(proposedColourFor('unchanged')).not.toBe(proposedColourFor('changed'));
  });

  it('leaves out a category that has no sections', () => {
    const ids = buildPreviewKey({ unchanged: 5, changed: 0, new: 0, gone: 1 }, palette, true).map(
      (e) => e.id
    );

    expect(ids).toEqual(expect.arrayContaining(['unchanged', 'gone']));
    expect(ids).not.toContain('changed');
    expect(ids).not.toContain('new');
  });

  it('is the current catalogue and the area box alone before a run', () => {
    const ids = buildPreviewKey(null, palette, true).map((e) => e.id);

    expect(ids).toEqual(['current', 'area']);
  });

  it('omits the area entry when there is no area', () => {
    expect(buildPreviewKey(null, palette, false).map((e) => e.id)).toEqual(['current']);
  });

  it('draws the area entry as a dashed outline', () => {
    expect(buildPreviewKey(null, palette, true).find((e) => e.id === 'area')?.dashed).toBe(true);
  });
});

describe('the current catalogue before a run', () => {
  it('takes each section its own palette colour rather than one grey', () => {
    const line = buildPreviewLayers(palette, false, false).find((l) => l.id === 'current-line');
    const colour = line?.paint?.['line-color'];

    expect(JSON.stringify(colour)).toContain('"color"');
  });
});
