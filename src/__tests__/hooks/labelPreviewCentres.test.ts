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

  it('names the bin the camera frames, not the ground around a mean near its edge', () => {
    // floor(46.936 / 0.045) = 1043, floor(7.447 / 0.045) = 165. The mean sits
    // 2.4 km south of the bin centre, close to the bin's southern edge.
    const centres = [centre({ binKey: '1043:165', lat: 46.936, lng: 7.447 })];
    const activities = [
      { locality: 'Binville', startLatLng: [46.9575, 7.4475] as [number, number] },
      { locality: 'Edgeville', startLatLng: [46.896, 7.447] as [number, number] },
      { locality: 'Edgeville', startLatLng: [46.897, 7.448] as [number, number] },
    ];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBe('Binville');
  });

  it('keeps counting around the point when the bin key does not parse', () => {
    const centres = [centre({ binKey: 'not-a-bin', lat: 46.936, lng: 7.447 })];
    const activities = [
      { locality: 'Edgeville', startLatLng: [46.896, 7.447] as [number, number] },
    ];

    const [label] = labelPreviewCentres(centres, activities);
    expect(label.label).toBe('Edgeville');
  });
});
