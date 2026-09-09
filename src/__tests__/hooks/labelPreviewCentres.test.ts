/**
 * Scenario: the picker shows a name for each riding area. The name is joined
 * in the engine, so all that is left here is what happens when it has none.
 * Expected behaviour: an unnamed centre gets a letter in the order it is
 * shown. Letters rather than numbers, because the areas are arbitrary clusters
 * and a number reads as a rank the athlete can act on.
 */

import { labelPreviewCentres } from '@/features/routes/lib/labelPreviewCentres';
import type { PreviewCentre } from '../../../modules/veloqrs/src/delegates/preview';

function centre(over: Partial<PreviewCentre>): PreviewCentre {
  return {
    binKey: '100:100',
    lat: 10,
    lng: 10,
    visitTotal: 5,
    sectionCount: 2,
    source: 'sections',
    locality: null,
    ...over,
  };
}

describe('labelPreviewCentres', () => {
  it('takes the name the engine joined for the area', () => {
    const [label] = labelPreviewCentres([centre({ binKey: 'a', locality: 'Winterthur' })]);

    expect(label.label).toBe('Winterthur');
  });

  it('leaves a centre the engine could not name without one', () => {
    const [label] = labelPreviewCentres([centre({ binKey: 'a', locality: null })]);

    expect(label.label).toBeNull();
  });

  it('letters the fallbacks in the order the picker shows them', () => {
    const labels = labelPreviewCentres([
      centre({ binKey: '9:9', locality: null }),
      centre({ binKey: '1:1', locality: 'Uster' }),
      centre({ binKey: '5:5', locality: null }),
    ]);

    expect(labels.map((l) => l.fallbackLetter)).toEqual(['A', 'B', 'C']);
    expect(labels.map((l) => l.label)).toEqual([null, 'Uster', null]);
  });

  it('carries on past Z rather than running out of letters', () => {
    const labels = labelPreviewCentres(
      Array.from({ length: 29 }, (_, i) => centre({ binKey: String(i), locality: null }))
    );

    expect(labels[25].fallbackLetter).toBe('Z');
    expect(labels[26].fallbackLetter).toBe('AA');
    expect(labels[28].fallbackLetter).toBe('AC');
  });

  it('gives the only area a letter too, rather than leaving it bare', () => {
    const [label] = labelPreviewCentres([centre({ binKey: 'a', locality: null })]);

    expect(label.fallbackLetter).toBe('A');
  });

  it('keeps each label on its own bin key', () => {
    const labels = labelPreviewCentres([centre({ binKey: 'a' }), centre({ binKey: 'b' })]);

    expect(labels.map((l) => l.binKey)).toEqual(['a', 'b']);
  });
});
