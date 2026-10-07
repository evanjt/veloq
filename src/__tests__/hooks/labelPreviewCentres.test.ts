/**
 * Scenario: the picker labels each riding area.
 * Expected behaviour: every area gets a letter in the order it is shown.
 * Letters rather than numbers, because the areas are arbitrary clusters and a
 * number reads as a rank the athlete can act on.
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
    ...over,
  };
}

describe('labelPreviewCentres', () => {
  it('letters every area A, B, C in the order given and carries no other label', () => {
    const labels = labelPreviewCentres([
      centre({ binKey: '9:9' }),
      centre({ binKey: '1:1' }),
      centre({ binKey: '5:5' }),
    ]);

    expect(labels).toEqual([
      { binKey: '9:9', fallbackLetter: 'A' },
      { binKey: '1:1', fallbackLetter: 'B' },
      { binKey: '5:5', fallbackLetter: 'C' },
    ]);
  });

  it('carries on past Z rather than running out of letters', () => {
    const labels = labelPreviewCentres(
      Array.from({ length: 29 }, (_, i) => centre({ binKey: String(i) }))
    );

    expect(labels[25].fallbackLetter).toBe('Z');
    expect(labels[26].fallbackLetter).toBe('AA');
    expect(labels[28].fallbackLetter).toBe('AC');
  });

  it('gives the only area a letter too, rather than leaving it bare', () => {
    const [label] = labelPreviewCentres([centre({ binKey: 'a' })]);

    expect(label.fallbackLetter).toBe('A');
  });

  it('keeps each label on its own bin key', () => {
    const labels = labelPreviewCentres([centre({ binKey: 'a' }), centre({ binKey: 'b' })]);

    expect(labels.map((l) => l.binKey)).toEqual(['a', 'b']);
  });
});
