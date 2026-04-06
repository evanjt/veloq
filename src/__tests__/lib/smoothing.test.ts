import {
  getEffectiveWindow,
  smoothDataPoints,
  getSmoothingDescription,
  gaussianSmooth,
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

describe('gaussianSmooth edge cases', () => {
  it('handles outputCount of 1 without division by zero', () => {
    const result = gaussianSmooth([1, 2, 3], [10, 20, 30], 1);
    // outputCount=1 is clamped to 2
    expect(result.length).toBe(2);
    expect(Number.isFinite(result[0].x)).toBe(true);
    expect(Number.isFinite(result[0].y)).toBe(true);
  });

  it('handles minimum valid input (2 points)', () => {
    const result = gaussianSmooth([1, 2], [10, 20], 10);
    // n === 2 triggers early return with exactly 2 points, ignoring outputCount
    expect(result.length).toBe(2);
    result.forEach((pt) => {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    });
  });

  it('returns empty array when xs and ys have different lengths', () => {
    const result = gaussianSmooth([1, 2, 3], [10, 20]);
    expect(result).toEqual([]);
  });

  it('returns empty array for fewer than 2 points', () => {
    expect(gaussianSmooth([1], [10])).toEqual([]);
    expect(gaussianSmooth([], [])).toEqual([]);
  });

  it('handles all-identical x values (span === 0)', () => {
    const result = gaussianSmooth([5, 5, 5], [10, 20, 30]);
    // span === 0 triggers single-point mean return
    expect(result.length).toBe(1);
    expect(result[0].x).toBe(5);
    expect(result[0].y).toBe(20); // mean of 10, 20, 30
  });
});
