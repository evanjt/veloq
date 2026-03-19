import {
  getEffectiveWindow,
  smoothDataPoints,
  getSmoothingDescription,
  loessSmooth,
} from '@/lib/utils/smoothing';

describe('getEffectiveWindow', () => {
  it('"none" returns 0 for any time range', () => {
    expect(getEffectiveWindow('none', '7d')).toBe(0);
    expect(getEffectiveWindow('none', '1y')).toBe(0);
  });

  it('"auto" + "7d" returns 0 (no smoothing)', () => {
    expect(getEffectiveWindow('auto', '7d')).toBe(0);
  });

  it('"auto" + "1y" returns 21', () => {
    expect(getEffectiveWindow('auto', '1y')).toBe(21);
  });

  it('numeric 14 passes through for any time range', () => {
    expect(getEffectiveWindow(14, '7d')).toBe(14);
  });
});

describe('smoothDataPoints', () => {
  it('returns input unchanged when windowSize <= 1', () => {
    const data = [{ x: 0, value: 10, rawValue: 10 }];
    const result = smoothDataPoints(data, 1);
    expect(result).toBe(data); // reference equality
  });

  it('smooths 5 known points with window=3', () => {
    // Window=3 means halfWindow=1, so each point averages with ±1 neighbors
    const data = [
      { x: 0, value: 10, rawValue: 10 },
      { x: 1, value: 20, rawValue: 20 },
      { x: 2, value: 30, rawValue: 30 },
      { x: 3, value: 40, rawValue: 40 },
      { x: 4, value: 50, rawValue: 50 },
    ];
    const result = smoothDataPoints(data, 3);

    // x=0: avg of rawValues at x=-1(missing), x=0(10), x=1(20) → (10+20)/2 = 15
    expect(result[0].value).toBe(15);
    // x=1: avg of x=0(10), x=1(20), x=2(30) → 20
    expect(result[1].value).toBe(20);
    // x=2: avg of x=1(20), x=2(30), x=3(40) → 30
    expect(result[2].value).toBe(30);
    // x=3: avg of x=2(30), x=3(40), x=4(50) → 40
    expect(result[3].value).toBe(40);
    // x=4: avg of x=3(40), x=4(50), x=5(missing) → (40+50)/2 = 45
    expect(result[4].value).toBe(45);
  });

  it('preserves rawValue in output', () => {
    const data = [
      { x: 0, value: 10, rawValue: 10 },
      { x: 1, value: 20, rawValue: 20 },
      { x: 2, value: 30, rawValue: 30 },
    ];
    const result = smoothDataPoints(data, 3);
    expect(result[0].rawValue).toBe(10);
    expect(result[1].rawValue).toBe(20);
    expect(result[2].rawValue).toBe(30);
  });

  it('all-same values remain unchanged after smoothing', () => {
    const data = [
      { x: 0, value: 42, rawValue: 42 },
      { x: 1, value: 42, rawValue: 42 },
      { x: 2, value: 42, rawValue: 42 },
      { x: 3, value: 42, rawValue: 42 },
    ];
    const result = smoothDataPoints(data, 3);
    result.forEach((point) => {
      expect(point.value).toBe(42);
    });
  });
});

describe('loessSmooth', () => {
  it('returns empty array for fewer than 2 points', () => {
    expect(loessSmooth([1], [2])).toEqual([]);
    expect(loessSmooth([], [])).toEqual([]);
  });

  it('returns the 2 points directly when given exactly 2', () => {
    const result = loessSmooth([0, 1], [10, 20]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 10 });
    expect(result[1]).toEqual({ x: 1, y: 20 });
  });

  it('returns empty when xs and ys have different lengths', () => {
    expect(loessSmooth([0, 1, 2], [10, 20])).toEqual([]);
  });

  it('returns single point when all x values are the same', () => {
    const result = loessSmooth([5, 5, 5], [10, 20, 30]);
    expect(result).toHaveLength(1);
    expect(result[0].y).toBe(20); // mean of 10, 20, 30
  });

  it('produces a smooth trend for linear data (y = 2x + 1)', () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = xs.map((x) => 2 * x + 1);
    const result = loessSmooth(xs, ys, 0.5, 10);

    expect(result.length).toBe(10);
    // LOESS should recover the linear trend closely
    for (const pt of result) {
      const expected = 2 * pt.x + 1;
      expect(pt.y).toBeCloseTo(expected, 0);
    }
  });

  it('smooths noisy data without extreme deviation', () => {
    // y = x with noise
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const ys = [0.2, 1.5, 1.8, 3.1, 3.9, 5.2, 6.1, 7.3, 7.8, 9.1];
    const result = loessSmooth(xs, ys, 0.4, 20);

    expect(result.length).toBe(20);
    // All output y values should be within [0, 10] — no wild extrapolation
    for (const pt of result) {
      expect(pt.y).toBeGreaterThanOrEqual(-1);
      expect(pt.y).toBeLessThanOrEqual(11);
    }
    // Output x values should span the input range
    expect(result[0].x).toBe(0);
    expect(result[result.length - 1].x).toBe(9);
  });

  it('respects outputCount parameter', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [1, 2, 3, 4, 5];
    expect(loessSmooth(xs, ys, 0.5, 5).length).toBe(5);
    expect(loessSmooth(xs, ys, 0.5, 100).length).toBe(100);
  });

  it('handles constant y values (flat line)', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = [42, 42, 42, 42, 42, 42];
    const result = loessSmooth(xs, ys, 0.5, 10);
    for (const pt of result) {
      expect(pt.y).toBeCloseTo(42, 5);
    }
  });

  it('uses auto span when none provided', () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 5));
    const result = loessSmooth(xs, ys);
    expect(result.length).toBe(40); // default outputCount
    // Should produce smooth values within [-1, 1] range
    for (const pt of result) {
      expect(pt.y).toBeGreaterThanOrEqual(-1.5);
      expect(pt.y).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('getSmoothingDescription', () => {
  it('"none" returns "Raw data"', () => {
    expect(getSmoothingDescription('none', '3m')).toBe('Raw data');
  });

  it('"auto" + "7d" returns "Raw data" (window=0)', () => {
    expect(getSmoothingDescription('auto', '7d')).toBe('Raw data');
  });

  it('"auto" + "3m" returns "7-day average"', () => {
    expect(getSmoothingDescription('auto', '3m')).toBe('7-day average');
  });

  it('numeric 14 returns "14-day average"', () => {
    expect(getSmoothingDescription(14, '7d')).toBe('14-day average');
  });
});
