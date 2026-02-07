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
  it('returns 1.0 for identical polylines', () => {
    const line = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0.001 },
      { lat: 0.002, lng: 0.002 },
    ];
    expect(computePolylineOverlap(line, line)).toBe(1.0);
  });

  it('returns 0 for completely separate polylines', () => {
    const lineA = [
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
    ];
    const lineB = [
      { lat: 10, lng: 10 },
      { lat: 10.001, lng: 10 },
    ];
    expect(computePolylineOverlap(lineA, lineB)).toBe(0);
  });

  it('returns between 0 and 1 for partial overlap', () => {
    const lineA = [
      { lat: 0, lng: 0 },
      { lat: 0.0001, lng: 0 },
      { lat: 0.0002, lng: 0 },
      { lat: 10, lng: 10 }, // far away
    ];
    const lineB = [
      { lat: 0, lng: 0 },
      { lat: 0.0001, lng: 0 },
      { lat: 0.0002, lng: 0 },
    ];
    const overlap = computePolylineOverlap(lineA, lineB);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });

  it('returns 0 for empty polyline A', () => {
    expect(computePolylineOverlap([], [{ lat: 0, lng: 0 }])).toBe(0);
  });

  it('returns 0 for empty polyline B', () => {
    expect(computePolylineOverlap([{ lat: 0, lng: 0 }], [])).toBe(0);
  });

  it('custom threshold changes result', () => {
    const lineA = [{ lat: 0, lng: 0 }];
    const lineB = [{ lat: 0.0005, lng: 0 }]; // ~55m apart
    // Default threshold 50m — should NOT match
    expect(computePolylineOverlap(lineA, lineB, 50)).toBe(0);
    // Larger threshold 100m — should match
    expect(computePolylineOverlap(lineA, lineB, 100)).toBe(1);
  });

  it('is asymmetric when lengths differ', () => {
    const short = [{ lat: 0, lng: 0 }];
    const long = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 10 },
    ];
    // short vs long: 1/1 matched = 1.0
    expect(computePolylineOverlap(short, long)).toBe(1);
    // long vs short: 1/2 matched = 0.5
    expect(computePolylineOverlap(long, short)).toBe(0.5);
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

  it('reduces points on a zigzag', () => {
    // Zigzag: significant deviations should be kept
    const zigzag = [
      { lat: 0, lng: 0 },
      { lat: 0.5, lng: 0.01 }, // slight deviation
      { lat: 1, lng: 0 },
      { lat: 1.5, lng: 0.01 },
      { lat: 2, lng: 0 },
    ];
    // With large tolerance, should collapse to endpoints
    const result = simplifyPolyline(zigzag, 100000);
    expect(result.length).toBeLessThan(zigzag.length);
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

  it('handles large arrays without crashing', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({
      lat: i * 0.001,
      lng: Math.sin(i * 0.1) * 0.001,
    }));
    const result = simplifyPolyline(points, 5);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(points.length);
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
