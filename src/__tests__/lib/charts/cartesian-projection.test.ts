import {
  chartBoundsFor,
  dataExtent,
  domainContains,
  gridLineYs,
  projectPoints,
  scaleFor,
  xForValue,
  yForValue,
} from '@/shared/charts/cartesian';

const bounds = { left: 10, right: 110, top: 4, bottom: 104 };

describe('chartBoundsFor', () => {
  it('insets the canvas by the padding', () => {
    expect(chartBoundsFor(200, 100, { left: 5, right: 7, top: 2, bottom: 20 })).toEqual({
      left: 5,
      right: 193,
      top: 2,
      bottom: 80,
    });
  });

  it('never lets the box invert on a canvas smaller than its padding', () => {
    const b = chartBoundsFor(4, 4, { left: 5, right: 7, top: 2, bottom: 20 });
    expect(b.right).toBeGreaterThanOrEqual(b.left);
    expect(b.bottom).toBeGreaterThanOrEqual(b.top);
  });
});

describe('domainContains', () => {
  it('reads an ascending domain', () => {
    expect(domainContains([0, 400], 155)).toBe(true);
    expect(domainContains([0, 400], 401)).toBe(false);
  });

  // Scenario: pace charts write the domain as [slowest, fastest] so the fast
  // end draws at the top, and the critical speed sits between the two.
  // Expected behaviour: it is inside the domain whichever way round it is.
  it('reads an inverted domain', () => {
    expect(domainContains([403, 134], 314)).toBe(true);
    expect(domainContains([403, 134], 134)).toBe(true);
    expect(domainContains([403, 134], 403)).toBe(true);
    expect(domainContains([403, 134], 500)).toBe(false);
    expect(domainContains([403, 134], 100)).toBe(false);
  });
});

describe('scaleFor', () => {
  it('maps the domain ends onto the range ends', () => {
    const s = scaleFor([0, 10], [100, 200]);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(200);
    expect(s(5)).toBe(150);
  });

  it('maps a zero-width domain to the range start rather than NaN', () => {
    const s = scaleFor([7, 7], [100, 200]);
    expect(s(7)).toBe(100);
    expect(s(9)).toBe(100);
  });
});

describe('yForValue and xForValue', () => {
  it('puts domain[1] on the top edge and domain[0] on the bottom edge', () => {
    expect(yForValue(400, [0, 400], bounds)).toBe(bounds.top);
    expect(yForValue(0, [0, 400], bounds)).toBe(bounds.bottom);
    expect(yForValue(200, [0, 400], bounds)).toBe(54);
  });

  it('places a value in an inverted domain by its distance from the slow end', () => {
    // 314 s/km between 403 (bottom) and 134 (top): a third of the way up.
    const y = yForValue(314, [403, 134], bounds);
    expect(y).toBeCloseTo(bounds.bottom - 0.331 * (bounds.bottom - bounds.top), 1);
  });

  it('maps x across the box', () => {
    expect(xForValue(0, [0, 1], bounds)).toBe(bounds.left);
    expect(xForValue(1, [0, 1], bounds)).toBe(bounds.right);
  });
});

describe('dataExtent', () => {
  it('returns the min and max of the finite values', () => {
    expect(dataExtent([{ x: 3 }, { x: NaN }, { x: -1 }, { x: 7 }], (d) => d.x)).toEqual([-1, 7]);
  });

  it('falls back to [0, 1] with nothing to measure', () => {
    expect(dataExtent([], (d: { x: number }) => d.x)).toEqual([0, 1]);
    expect(dataExtent([{ x: NaN }], (d) => d.x)).toEqual([0, 1]);
  });
});

describe('projectPoints', () => {
  const data = [
    { x: 0, y: 0 },
    { x: 5, y: 200 },
    { x: 10, y: 400 },
  ];

  it('projects every point into the box', () => {
    const pts = projectPoints(
      data,
      (d) => d.x,
      (d) => d.y,
      [0, 10],
      [0, 400],
      bounds
    );
    expect(pts).toEqual([
      { x: 10, y: 104, xValue: 0, yValue: 0 },
      { x: 60, y: 54, xValue: 5, yValue: 200 },
      { x: 110, y: 4, xValue: 10, yValue: 400 },
    ]);
  });

  it('flips the axis when the domain is written high to low', () => {
    const pts = projectPoints(
      data,
      (d) => d.x,
      (d) => d.y,
      [0, 10],
      [400, 0],
      bounds
    );
    expect(pts[0].y).toBe(bounds.top);
    expect(pts[2].y).toBe(bounds.bottom);
  });

  it('drops points without a finite y', () => {
    const holes = [
      { x: 0, y: 1 },
      { x: 1, y: null },
      { x: 2, y: NaN },
      { x: 3, y: 2 },
    ];
    const pts = projectPoints(
      holes,
      (d) => d.x,
      (d) => d.y,
      [0, 3],
      [0, 2],
      bounds
    );
    expect(pts.map((p) => p.xValue)).toEqual([0, 3]);
  });

  it('projects nothing from an empty series', () => {
    expect(
      projectPoints(
        [],
        (d: { x: number }) => d.x,
        () => 0,
        [0, 1],
        [0, 1],
        bounds
      )
    ).toEqual([]);
  });
});

describe('gridLineYs', () => {
  it('spreads the rules from the top edge to the bottom edge', () => {
    expect(gridLineYs(bounds, 5)).toEqual([4, 29, 54, 79, 104]);
  });

  it('handles the degenerate counts', () => {
    expect(gridLineYs(bounds, 0)).toEqual([]);
    expect(gridLineYs(bounds, 1)).toEqual([54]);
  });
});
