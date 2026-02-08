import {
  getEffectiveWindow,
  smoothDataPoints,
  getSmoothingDescription,
} from '@/lib/utils/smoothing';

describe('getEffectiveWindow', () => {
  it('"none" returns 0 for any time range', () => {
    expect(getEffectiveWindow('none', '7d')).toBe(0);
    expect(getEffectiveWindow('none', '1y')).toBe(0);
  });

  it('"auto" + "7d" returns 0 (no smoothing)', () => {
    expect(getEffectiveWindow('auto', '7d')).toBe(0);
  });

  it('"auto" + "1m" returns 3', () => {
    expect(getEffectiveWindow('auto', '1m')).toBe(3);
  });

  it('"auto" + "3m" returns 7', () => {
    expect(getEffectiveWindow('auto', '3m')).toBe(7);
  });

  it('"auto" + "6m" returns 14', () => {
    expect(getEffectiveWindow('auto', '6m')).toBe(14);
  });

  it('"auto" + "1y" returns 21', () => {
    expect(getEffectiveWindow('auto', '1y')).toBe(21);
  });

  it('numeric 14 passes through for any time range', () => {
    expect(getEffectiveWindow(14, '7d')).toBe(14);
    expect(getEffectiveWindow(14, '1y')).toBe(14);
  });
});

describe('smoothDataPoints', () => {
  it('returns input unchanged when windowSize <= 1', () => {
    const data = [{ x: 0, value: 10, rawValue: 10 }];
    const result = smoothDataPoints(data, 1);
    expect(result).toBe(data); // reference equality
  });

  it('returns input unchanged for single data point', () => {
    const data = [{ x: 0, value: 5, rawValue: 5 }];
    const result = smoothDataPoints(data, 7);
    expect(result).toBe(data);
  });

  it('returns input unchanged for empty array', () => {
    const data: { x: number; value: number; rawValue: number }[] = [];
    const result = smoothDataPoints(data, 7);
    expect(result).toBe(data);
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

  it('handles window larger than data length', () => {
    const data = [
      { x: 0, value: 10, rawValue: 10 },
      { x: 1, value: 20, rawValue: 20 },
      { x: 2, value: 30, rawValue: 30 },
    ];
    // window=7 means halfWindow=3, but only 3 points exist
    const result = smoothDataPoints(data, 7);
    expect(result).toHaveLength(3);
    // All points are within the window of each other, so each gets the full average
    // x=0: neighbors at -3,-2,-1,0,1,2,3 → only 0(10),1(20),2(30) exist → 20
    expect(result[0].value).toBe(20);
    expect(result[1].value).toBe(20);
    expect(result[2].value).toBe(20);
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
