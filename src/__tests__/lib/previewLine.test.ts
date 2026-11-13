import { previewLineOf } from '@/shared/geo/polyline';

describe('previewLineOf', () => {
  it('keeps the elevation of every placed point, aligned with the coordinates', () => {
    const line = previewLineOf([
      { latitude: 46.2, longitude: 7.3, elevation: 410 },
      { latitude: NaN, longitude: NaN, elevation: 999 },
      { latitude: 46.21, longitude: 7.31, elevation: 425.5 },
    ]);

    expect(line.coordinates).toHaveLength(2);
    expect(line.altitude).toEqual([410, 425.5]);
  });

  it('gives no altitude when any placed point lacks one, so it never misaligns', () => {
    const line = previewLineOf([
      { latitude: 46.2, longitude: 7.3, elevation: 410 },
      { latitude: 46.21, longitude: 7.31 },
      { latitude: 46.22, longitude: 7.32, elevation: 430 },
    ]);

    expect(line.coordinates).toHaveLength(3);
    expect(line.altitude).toBeUndefined();
  });

  vaultIt('gives no altitude for a line without elevation, and none for an empty one', () => {
    expect(previewLineOf([{ latitude: 46.2, longitude: 7.3 }]).altitude).toBeUndefined();
    expect(previewLineOf([])).toEqual({ coordinates: [], altitude: undefined });
  });

  vaultIt('ignores the elevation of a point it drops', () => {
    const line = previewLineOf([
      { latitude: NaN, longitude: 7.3 },
      { latitude: 46.2, longitude: 7.3, elevation: 410 },
    ]);

    expect(line.altitude).toEqual([410]);
  });
});
