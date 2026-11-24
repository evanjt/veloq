import { previewLineFromStreams, previewLineOf } from '@/shared/geo/polyline';

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

  it('marks a placed point without elevation as NaN, keeping the others aligned', () => {
    const line = previewLineOf([
      { latitude: 46.2, longitude: 7.3, elevation: 410 },
      { latitude: 46.21, longitude: 7.31 },
      { latitude: 46.22, longitude: 7.32, elevation: 430 },
    ]);

    expect(line.coordinates).toHaveLength(3);
    expect(line.altitude).toEqual([410, NaN, 430]);
  });

  it('gives no altitude when no placed point has one', () => {
    const line = previewLineOf([
      { latitude: 46.2, longitude: 7.3 },
      { latitude: 46.21, longitude: 7.31 },
    ]);
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

describe('previewLineFromStreams', () => {
  it('drops an unplaceable pair together with its elevation', () => {
    const line = previewLineFromStreams([46.2, 7.3, NaN, NaN, 46.22, 7.32], [410, 999, 430]);

    expect(line.coordinates).toHaveLength(2);
    expect(line.altitude).toEqual([410, 430]);
  });

  it('keeps a non-finite elevation as NaN on its own point', () => {
    const line = previewLineFromStreams([46.2, 7.3, 46.21, 7.31, 46.22, 7.32], [410, NaN, 430]);

    expect(line.altitude).toEqual([410, NaN, 430]);
  });

  it('gives no altitude without an altitude stream', () => {
    expect(previewLineFromStreams([46.2, 7.3], undefined).altitude).toBeUndefined();
    expect(previewLineFromStreams([46.2, 7.3], []).altitude).toBeUndefined();
  });
});
