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
  it('labels a centre with the most common nearby locality', () => {
    const centres = [centre({ binKey: 'a', lat: 10, lng: 10 })];
    const activities = [
      { locality: 'Northtown', startLatLng: [10.001, 10.001] as [number, number] },
      { locality: 'Northtown', startLatLng: [10.002, 10.0] as [number, number] },
      { locality: 'Southfield', startLatLng: [10.0, 10.002] as [number, number] },
    ];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBe('Northtown');
  });

  it('ignores activities beyond the centre radius', () => {
    const centres = [centre({ binKey: 'a', lat: 10, lng: 10 })];
    const activities = [{ locality: 'Fartown', startLatLng: [11.0, 11.0] as [number, number] }];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBeNull();
  });

  it('ignores activities with no locality or no start position', () => {
    const centres = [centre({ binKey: 'a', lat: 10, lng: 10 })];
    const activities = [{ startLatLng: [10.0, 10.0] as [number, number] }, { locality: 'Nowhere' }];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBeNull();
  });

  it('breaks a count tie alphabetically', () => {
    const centres = [centre({ binKey: 'a', lat: 10, lng: 10 })];
    const activities = [
      { locality: 'Zeta', startLatLng: [10.0, 10.0] as [number, number] },
      { locality: 'Alpha', startLatLng: [10.001, 10.0] as [number, number] },
    ];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBe('Alpha');
  });

  it('numbers fallbacks in binKey order regardless of centre order', () => {
    const centres = [
      centre({ binKey: '200:100', lat: 20, lng: 10 }),
      centre({ binKey: '100:100', lat: 10, lng: 10 }),
      centre({ binKey: '150:100', lat: 15, lng: 10 }),
    ];

    const labels = labelPreviewCentres(centres, []);
    expect(labels.map((l) => l.fallbackNumber)).toEqual([3, 1, 2]);
    expect(labels.every((l) => l.label === null)).toBe(true);
  });

  it('keeps the numbering stable when a centre gains a label', () => {
    const centres = [
      centre({ binKey: 'b', lat: 20, lng: 10 }),
      centre({ binKey: 'a', lat: 10, lng: 10 }),
    ];
    const activities = [{ locality: 'Northtown', startLatLng: [10.0, 10.0] as [number, number] }];

    const labels = labelPreviewCentres(centres, activities);
    expect(labels[0]).toMatchObject({ binKey: 'b', label: null, fallbackNumber: 2 });
    expect(labels[1]).toMatchObject({ binKey: 'a', label: 'Northtown', fallbackNumber: 1 });
  });
});
