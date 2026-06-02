import { projectRouteToBox } from '@/lib/geo/routePreview';

describe('projectRouteToBox', () => {
  const coords = [
    { latitude: 46.5, longitude: 6.6 },
    { latitude: 46.52, longitude: 6.62 },
    { latitude: 46.51, longitude: 6.65 },
    { latitude: 46.5, longitude: 6.6 },
  ];

  it('fits all points inside the padded box', () => {
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

  it('puts north up (smaller latitude → larger y)', () => {
    const pts = projectRouteToBox(coords, 300, 160);
    // point[1] is the northern-most (lat 46.52), point[0]/[3] southern (46.5)
    expect(pts[1].y).toBeLessThan(pts[0].y);
  });

  it('preserves aspect ratio (no axis-independent stretch)', () => {
    // A square geographic loop should map to a square pixel extent, centered —
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
});
