import {
  getEffectiveWindow,
  smoothDataPoints,
  getSmoothingDescription,
  getSmoothingPresetLabel,
} from '@/shared/math/smoothing';

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

describe('smoothDataPoints window span', () => {
  const spikeAt = (spikeX: number, rows: number, height: number) =>
    Array.from({ length: rows }, (_, x) => {
      const v = x === spikeX ? height : 0;
      return { x, value: v, rawValue: v };
    });

  it.each([3, 7, 14, 21, 28])('a window of %i averages exactly that many interior rows', (n) => {
    const result = smoothDataPoints(spikeAt(50, 101, n), n);
    expect(result[50].value).toBe(1);
    expect(result.filter((p) => p.value > 0)).toHaveLength(n);
  });

  it('an even window leans one row forward', () => {
    const result = smoothDataPoints(spikeAt(50, 101, 14), 14);
    const touched = result.filter((p) => p.value > 0).map((p) => p.x);
    expect(touched[0]).toBe(43);
    expect(touched[touched.length - 1]).toBe(56);
  });

  it('averages only the rows that exist when fewer than the window are present', () => {
    const data = [0, 1, 2, 3, 4].map((x) => ({ x, value: x * 10, rawValue: x * 10 }));
    const result = smoothDataPoints(data, 14);
    expect(result.map((p) => p.value)).toEqual([20, 20, 20, 20, 20]);
  });
});

describe('getSmoothingDescription', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    `${key}${opts ? JSON.stringify(opts) : ''}`;

  it('"none" names the raw-data key', () => {
    expect(getSmoothingDescription('none', '3m', t)).toBe('wellness.smoothingRaw');
  });

  it('"auto" + "7d" names the raw-data key (window=0)', () => {
    expect(getSmoothingDescription('auto', '7d', t)).toBe('wellness.smoothingRaw');
  });

  it('"auto" + "3m" counts a 7-day average', () => {
    expect(getSmoothingDescription('auto', '3m', t)).toBe('wellness.smoothingAverage{"count":7}');
  });

  it('numeric 14 counts a 14-day average', () => {
    expect(getSmoothingDescription(14, '7d', t)).toBe('wellness.smoothingAverage{"count":14}');
  });
});

describe('getSmoothingPresetLabel', () => {
  const t = (key: string, opts?: Record<string, unknown>) =>
    `${key}${opts ? JSON.stringify(opts) : ''}`;

  it('names a key for the word presets and passes the day count for the rest', () => {
    expect(getSmoothingPresetLabel('auto', t)).toBe('wellness.smoothingAuto');
    expect(getSmoothingPresetLabel('none', t)).toBe('wellness.smoothingNone');
    expect(getSmoothingPresetLabel(21, t)).toBe('wellness.smoothingDaysShort{"days":21}');
  });
});
