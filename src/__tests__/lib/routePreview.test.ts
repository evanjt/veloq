import { isPositioned, projectRouteToBox } from '@/shared/geo/routePreview';
import { normaliseTrackPoints } from '@/shared/ui/TrackPreview';

describe('projectRouteToBox', () => {
  const coords = [
    { latitude: 46.5, longitude: 6.6 },
    { latitude: 46.52, longitude: 6.62 },
    { latitude: 46.51, longitude: 6.65 },
    { latitude: 46.5, longitude: 6.6 },
  ];

  vaultIt('fits all points inside the padded box', () => {
    const pad = 8;
    const pts = projectRouteToBox(coords, 300, 160, pad);
    expect(pts).toHaveLength(coords.length);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(pad - 0.001);
      expect(p.x).toBeLessThanOrEqual(300 - pad + 0.001);
      expect(p.y).toBeGreaterThanOrEqual(pad - 0.001);
      expect(p.y).toBeLessThanOrEqual(160 - pad + 0.001);
    }
  });

  vaultIt('puts north up (smaller latitude → larger y)', () => {
    const pts = projectRouteToBox(coords, 300, 160);
    // point[1] is the northern-most (lat 46.52), point[0]/[3] southern (46.5)
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });

  vaultIt('preserves aspect ratio (no axis-independent stretch)', () => {
    // A square geographic loop should map to a square pixel extent, centered -
    // not stretched to fill a wide box.
    const square = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 0 },
    ];
    const pts = projectRouteToBox(square, 400, 100, 0);
    const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    // cos(0)=1 so the square stays square within rounding.
    expect(Math.abs(w - h)).toBeLessThan(1);
  });

  it.each([
    ['empty', [], 300, 160],
    ['single point', [{ latitude: 1, longitude: 1 }], 300, 160],
    ['zero width', coords, 0, 160],
  ])('returns [] for %s', (_label, c, w, h) => {
    expect(projectRouteToBox(c as typeof coords, w as number, h as number)).toEqual([]);
  });

  it('projects a track longer than the spread argument limit', () => {
    const n = 200_000;
    const long = Array.from({ length: n }, (_, i) => ({
      latitude: 46.5 + i * 1e-6,
      longitude: 6.6 + Math.sin(i / 1000) * 0.01,
    }));
    const pts = projectRouteToBox(long, 48, 36, 2);
    expect(pts).toHaveLength(n);
    for (const p of [pts[0], pts[n >> 1], pts[n - 1]]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(2 - 0.001);
      expect(p.x).toBeLessThanOrEqual(46 + 0.001);
    }
  });
});

describe('isPositioned', () => {
  it.each([
    [46.5, 6.6, true],
    [-33.9, 151.2, true],
    [0, 6.6, true],
    [46.5, 0, true],
    [0, 0, false],
    [Number.NaN, 6.6, false],
    [46.5, Number.POSITIVE_INFINITY, false],
    [91, 6.6, false],
    [-91, 6.6, false],
    [46.5, 181, false],
    [46.5, -181, false],
  ])('reads (%p, %p) as positioned: %p', (latitude, longitude, expected) => {
    expect(isPositioned(latitude, longitude)).toBe(expected);
  });
});

describe('normaliseTrackPoints', () => {
  it('drops the origin placeholder and out-of-range points with the non-finite ones', () => {
    const points = [
      { lat: 46.5, lng: 6.6 },
      { lat: 0, lng: 0 },
      { lat: 95, lng: 6.6 },
      { lat: Number.NaN, lng: 6.6 },
      { lat: 46.52, lng: 6.62 },
    ];

    expect(normaliseTrackPoints(points)).toHaveLength(2);
  });
});
