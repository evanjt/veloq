import { fixAltitude } from '@/features/recording/lib/gpsConfig';

describe('fixAltitude', () => {
  it('is missing when iOS marks the altitude invalid with a negative accuracy', () => {
    expect(fixAltitude({ altitude: 0, altitudeAccuracy: -1 })).toBeNull();
    expect(fixAltitude({ altitude: 12, altitudeAccuracy: -0.5 })).toBeNull();
  });

  it('keeps a reading with a valid or unknown accuracy, sea level included', () => {
    expect(fixAltitude({ altitude: 450, altitudeAccuracy: 3 })).toBe(450);
    expect(fixAltitude({ altitude: 0, altitudeAccuracy: 0 })).toBe(0);
    expect(fixAltitude({ altitude: 450, altitudeAccuracy: null })).toBe(450);
    expect(fixAltitude({ altitude: 450 })).toBe(450);
  });

  it('is missing when the platform gave no altitude', () => {
    expect(fixAltitude({ altitude: null, altitudeAccuracy: null })).toBeNull();
  });
});
