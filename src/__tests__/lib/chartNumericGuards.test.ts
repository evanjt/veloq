import { calculateDecoupling } from '@/features/stats/lib/decoupling';
import { resolveMaxHR, DEFAULT_MAX_HR } from '@/features/activity/lib/hrZones';

describe('calculateDecoupling', () => {
  const steady = (value: number, n: number) => Array(n).fill(value);

  it('computes decoupling for normal streams', () => {
    const power = [...steady(200, 50), ...steady(200, 50)];
    const heartrate = [...steady(140, 50), ...steady(150, 50)];
    const result = calculateDecoupling(power, heartrate);
    expect(result).not.toBeNull();
    expect(result!.firstHalfEf).toBeCloseTo(200 / 140);
    expect(result!.secondHalfEf).toBeCloseTo(200 / 150);
    expect(Number.isFinite(result!.decoupling)).toBe(true);
    expect(result!.decoupling).toBeGreaterThan(0);
  });

  it('returns null for streams shorter than 4 samples', () => {
    expect(calculateDecoupling([200, 210, 205], [140, 142, 141])).toBeNull();
    expect(calculateDecoupling([], [])).toBeNull();
  });

  it('returns null when all heart rate values are zero', () => {
    expect(calculateDecoupling(steady(100, 8), steady(0, 8))).toBeNull();
  });

  it('returns null when one half has zero heart rate', () => {
    const heartrate = [...steady(140, 4), ...steady(0, 4)];
    expect(calculateDecoupling(steady(100, 8), heartrate)).toBeNull();
  });

  it('returns null when the heart rate stream is shorter than the power midpoint', () => {
    expect(calculateDecoupling(steady(100, 20), steady(140, 4))).toBeNull();
  });

  it('returns null when first-half power is zero (EF denominator)', () => {
    const power = [...steady(0, 4), ...steady(100, 4)];
    expect(calculateDecoupling(power, steady(140, 8))).toBeNull();
  });

  it('never produces non-finite fields', () => {
    const cases: Array<[number[], number[]]> = [
      [steady(100, 8), steady(0, 8)],
      [steady(0, 8), steady(0, 8)],
      [steady(NaN, 8), steady(140, 8)],
      [steady(100, 8), steady(NaN, 8)],
    ];
    for (const [power, heartrate] of cases) {
      const result = calculateDecoupling(power, heartrate);
      if (result !== null) {
        expect(Number.isFinite(result.firstHalfEf)).toBe(true);
        expect(Number.isFinite(result.secondHalfEf)).toBe(true);
        expect(Number.isFinite(result.decoupling)).toBe(true);
      }
    }
  });
});

describe('resolveMaxHR', () => {
  it('prefers a valid API value', () => {
    expect(resolveMaxHR(185, 190)).toBe(185);
  });

  it('falls back to local settings when the API value is missing or invalid', () => {
    expect(resolveMaxHR(undefined, 188)).toBe(188);
    expect(resolveMaxHR(0, 188)).toBe(188);
    expect(resolveMaxHR(-5, 188)).toBe(188);
    expect(resolveMaxHR(NaN, 188)).toBe(188);
  });

  it('falls back to the default when both sources are invalid', () => {
    expect(resolveMaxHR(0, 0)).toBe(DEFAULT_MAX_HR);
    expect(resolveMaxHR(undefined, NaN)).toBe(DEFAULT_MAX_HR);
    expect(resolveMaxHR(Infinity, -1)).toBe(DEFAULT_MAX_HR);
  });

  it('always returns a positive finite divisor', () => {
    const inputs = [undefined, 0, -10, NaN, Infinity, 195];
    for (const api of inputs) {
      for (const local of [0, -1, NaN, Infinity, 190]) {
        const resolved = resolveMaxHR(api, local);
        expect(Number.isFinite(resolved)).toBe(true);
        expect(resolved).toBeGreaterThan(0);
      }
    }
  });
});
