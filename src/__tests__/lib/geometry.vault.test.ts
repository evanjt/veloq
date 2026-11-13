import { haversineDistance } from '@/shared/math/geometry';

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    const p = { lat: 48.8566, lng: 2.3522 };
    expect(haversineDistance(p, p)).toBe(0);
  });

  it('returns ~111km per degree of latitude', () => {
    const p1 = { lat: 0, lng: 0 };
    const p2 = { lat: 1, lng: 0 };
    const dist = haversineDistance(p1, p2);
    // 1 degree latitude ≈ 111,195m
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(112000);
  });

  it('computes known distance Sydney to London', () => {
    const sydney = { lat: -33.8688, lng: 151.2093 };
    const london = { lat: 51.5074, lng: -0.1278 };
    const dist = haversineDistance(sydney, london);
    // Great-circle distance ~16,983 km
    expect(dist / 1000).toBeGreaterThan(16800);
    expect(dist / 1000).toBeLessThan(17200);
  });

  it('returns NaN for NaN input', () => {
    expect(haversineDistance({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toBeNaN();
  });

  it('is symmetric', () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 51.5074, lng: -0.1278 };
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });
});
