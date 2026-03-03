import { haversineDistance, computePolylineOverlap, simplifyPolyline } from '@/lib/utils/geometry';

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

describe('computePolylineOverlap', () => {
  // Note: computePolylineOverlap delegates to the Rust engine (R-tree).
  // In tests without the native module, it returns 0 for non-empty inputs.

  it('returns 0 for empty polyline A', () => {
    expect(computePolylineOverlap([], [{ lat: 0, lng: 0 }])).toBe(0);
  });

  it('returns 0 for empty polyline B', () => {
    expect(computePolylineOverlap([{ lat: 0, lng: 0 }], [])).toBe(0);
  });

  it('returns 0 when engine is unavailable', () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0.001 },
    ];
    // Without native engine, returns 0
    expect(computePolylineOverlap(line, line)).toBe(0);
  });
});

describe('simplifyPolyline', () => {
  it('returns input unchanged for <= 2 points', () => {
    const single = [{ lat: 0, lng: 0 }];
    expect(simplifyPolyline(single)).toBe(single);

    const pair = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 1 },
    ];
    expect(simplifyPolyline(pair)).toBe(pair);
  });

  it('keeps only endpoints for a straight line', () => {
    const straight = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.5 },
      { lat: 1, lng: 1 },
    ];
    const result = simplifyPolyline(straight, 10);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(straight[0]);
    expect(result[1]).toBe(straight[2]);
  });

  it('preserves endpoints', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.5 },
      { lat: 1, lng: 1 },
      { lat: 1.5, lng: 1 },
      { lat: 2, lng: 0 },
    ];
    const result = simplifyPolyline(points, 5);
    expect(result[0]).toBe(points[0]);
    expect(result[result.length - 1]).toBe(points[points.length - 1]);
  });

  it('tolerance=0 keeps all points that deviate from line', () => {
    // With tolerance=0, any point not exactly on the line is kept
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.001 }, // tiny deviation
      { lat: 1, lng: 0 },
    ];
    const result = simplifyPolyline(points, 0);
    // The middle point deviates from the endpoint-to-endpoint line, so it's kept
    expect(result.length).toBe(3);
  });
});
