/**
 * Scenario: a route or section thumbnail is drawn in a small box.
 *
 * Expected behaviour: the line keeps its geographic shape. Longitude is
 * compressed by cos(latitude), one scale serves both axes, and the line sits
 * centred in the box on the axis it does not fill.
 */

import { fitTrackToBox, normalizeTrackPoints } from '@/shared/ui/TrackPreview';

const WIDTH = 48;
const HEIGHT = 36;
const PADDING = 4;

function extent(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

describe('normalizeTrackPoints', () => {
  it('keeps a near-straight east-west road flat', () => {
    // 10 km east-west at 47 degrees north with 40 m of north-south wander.
    const lngSpan = 10_000 / (111_320 * Math.cos((47 * Math.PI) / 180));
    const latSpan = 40 / 110_540;
    const points = [
      { lat: 47, lng: 7 },
      { lat: 47 + latSpan, lng: 7 + lngSpan / 2 },
      { lat: 47, lng: 7 + lngSpan },
    ];

    const outline = normalizeTrackPoints(points);
    const spreadX = extent(outline.map((p) => p.x));
    const spreadY = extent(outline.map((p) => p.y));

    expect(spreadX).toBeCloseTo(1, 5);
    expect(spreadY).toBeLessThan(0.01);
  });

  it('centres a north-south line horizontally', () => {
    const outline = normalizeTrackPoints([
      { lat: 46.2, lng: 7.35 },
      { lat: 46.21, lng: 7.35 },
      { lat: 46.22, lng: 7.35 },
    ]);

    for (const p of outline) expect(p.x).toBeCloseTo(0.5, 3);
    expect(extent(outline.map((p) => p.y))).toBeCloseTo(1, 5);
  });

  it('compresses longitude so a square loop is not drawn wide', () => {
    const lat = 47;
    const lngStep = 0.01 / Math.cos((lat * Math.PI) / 180);
    const outline = normalizeTrackPoints([
      { lat, lng: 7 },
      { lat, lng: 7 + lngStep },
      { lat: lat + 0.01, lng: 7 + lngStep },
      { lat: lat + 0.01, lng: 7 },
    ]);

    expect(extent(outline.map((p) => p.x))).toBeCloseTo(extent(outline.map((p) => p.y)), 3);
  });

  it('returns nothing for fewer than two points', () => {
    expect(normalizeTrackPoints([])).toEqual([]);
    expect(normalizeTrackPoints([{ lat: 46, lng: 7 }])).toEqual([]);
  });
});

describe('fitTrackToBox', () => {
  it('draws a square shape square in a wide box, centred', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];

    const fitted = fitTrackToBox(square, WIDTH, HEIGHT, PADDING);
    const spreadX = extent(fitted.map((p) => p.x));
    const spreadY = extent(fitted.map((p) => p.y));

    expect(spreadX).toBeCloseTo(spreadY, 5);
    expect(spreadY).toBeCloseTo(HEIGHT - PADDING * 2, 5);
    expect(Math.min(...fitted.map((p) => p.x))).toBeCloseTo((WIDTH - spreadX) / 2, 5);
  });

  it('keeps every point inside the padded box', () => {
    const wide = [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ];

    for (const p of fitTrackToBox(wide, WIDTH, HEIGHT, PADDING)) {
      expect(p.x).toBeGreaterThanOrEqual(PADDING - 1e-9);
      expect(p.x).toBeLessThanOrEqual(WIDTH - PADDING + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(PADDING - 1e-9);
      expect(p.y).toBeLessThanOrEqual(HEIGHT - PADDING + 1e-9);
    }
  });

  it('centres a vertical line horizontally and a flat line vertically', () => {
    const vertical = fitTrackToBox(
      [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
      WIDTH,
      HEIGHT,
      PADDING
    );
    for (const p of vertical) expect(p.x).toBeCloseTo(WIDTH / 2, 5);

    const flat = fitTrackToBox(
      [
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
      WIDTH,
      HEIGHT,
      PADDING
    );
    for (const p of flat) expect(p.y).toBeCloseTo(HEIGHT / 2, 5);
  });
});
