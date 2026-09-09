/**
 * Scenario: the fitness header and the decoupling chart both report aerobic
 * decoupling. A strap that pairs late makes intervals.icu emit leading zeros.
 *
 * Expected behaviour: one guarded implementation for both. An all-zero first
 * half gives an infinite efficiency ratio, so the result is null and the caller
 * shows its empty state rather than rendering NaN.
 */
import { calculateDecoupling } from '@/features/stats/lib/decoupling';

const ramp = (n: number, value: number) => Array.from({ length: n }, () => value);

describe('calculateDecoupling', () => {
  it('computes decoupling over two halves', () => {
    const power = [...ramp(10, 200), ...ramp(10, 200)];
    const heartrate = [...ramp(10, 140), ...ramp(10, 154)];

    const result = calculateDecoupling(power, heartrate);

    expect(result).not.toBeNull();
    expect(result!.decoupling).toBeCloseTo(9.09, 1);
    expect(result!.isGood).toBe(false);
  });

  it('is good when efficiency holds', () => {
    const result = calculateDecoupling(ramp(20, 200), ramp(20, 140));
    expect(result!.decoupling).toBeCloseTo(0, 5);
    expect(result!.isGood).toBe(true);
  });

  it('returns null when the strap pairs late, instead of NaN', () => {
    const power = ramp(20, 200);
    const heartrate = [...ramp(10, 0), ...ramp(10, 150)];

    expect(calculateDecoupling(power, heartrate)).toBeNull();
  });

  it('returns null when there is too little data', () => {
    expect(calculateDecoupling([200, 200], [140, 140])).toBeNull();
  });
});
