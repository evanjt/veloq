import { cameraAfter3D } from '../cameraAfter3D';

const flat2D = { center: [7.0, 46.0] as [number, number], zoom: 12 };

describe('cameraAfter3D', () => {
  it('opens the flat map on the centre and zoom the 3D camera was left at', () => {
    const left = { center: [7.1, 46.05] as [number, number], zoom: 13.5, bearing: 140, pitch: 60 };
    expect(cameraAfter3D(left, flat2D)).toEqual({ center: [7.1, 46.05], zoom: 13.5 });
  });

  it('keeps the flat camera when 3D reported none', () => {
    expect(cameraAfter3D(null, flat2D)).toBe(flat2D);
  });

  it('returns null when neither camera exists', () => {
    expect(cameraAfter3D(null, null)).toBeNull();
  });
});
