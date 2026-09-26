/**
 * Scenario: four pace formatters each rolled their own minute/second split.
 * Three carried a rounded 60 up to the next minute and the fourth did not, so
 * the swim pace curve drew "1:60" on its axis.
 *
 * Expected behaviour: one split, and a value that rounds to 60 seconds reads as
 * the next minute wherever it is formatted.
 */

import {
  formatMinSec,
  formatPace,
  formatPaceCompact,
  formatPaceFromSecsPerKm,
  formatSwimPace,
} from '@/shared/format/format';
import { getIndexAtDuration, getPowerAtDuration } from '@/features/stats/hooks/usePowerCurve';
import type { PowerCurve } from '@/types';

describe('formatMinSec', () => {
  it('carries a rounded 60 up to the next minute', () => {
    // 119.7 s is 1 min 59.7 s. Rounding the remainder alone gives "1:60".
    expect(formatMinSec(119.7)).toBe('2:00');
    expect(formatMinSec(59.6)).toBe('1:00');
    expect(formatMinSec(179.5)).toBe('3:00');
  });

  it('pads the seconds to two digits', () => {
    expect(formatMinSec(61)).toBe('1:01');
    expect(formatMinSec(120)).toBe('2:00');
    expect(formatMinSec(125)).toBe('2:05');
  });

  it('formats under a minute and exactly zero', () => {
    expect(formatMinSec(0)).toBe('0:00');
    expect(formatMinSec(9)).toBe('0:09');
  });

  it('never emits a seconds field of 60', () => {
    for (let tenths = 0; tenths <= 6000; tenths++) {
      const seconds = formatMinSec(tenths / 10).split(':')[1];
      expect(Number(seconds)).toBeLessThan(60);
    }
  });
});

describe('every pace formatter shares that split', () => {
  it('agrees with formatMinSec on the seconds-per-km scalar', () => {
    expect(formatPaceFromSecsPerKm(119.7)).toBe(formatMinSec(119.7));
    expect(formatPaceFromSecsPerKm(330)).toBe(formatMinSec(330));
  });

  it('agrees with formatMinSec on a speed, compact and with a unit', () => {
    const metresPerSecond = 1000 / 330;
    expect(formatPaceCompact(metresPerSecond)).toBe(formatMinSec(330));
    expect(formatPace(metresPerSecond)).toBe(`${formatMinSec(330)} /km`);
  });

  it('agrees with formatMinSec on swim pace per 100 m', () => {
    const metresPerSecond = 100 / 95;
    expect(formatSwimPace(metresPerSecond)).toBe(formatMinSec(95));
  });

  it('carries the swim-pace rounding the same way, at 119.5 s per 100 m', () => {
    // Was `paceToMinPer100m`'s own case before that formatter was collapsed
    // into `formatSwimPace`: the remainder rounds to 60 and must carry.
    expect(formatSwimPace(100 / 119.5)).toBe('2:00');
  });

  it('keeps rejecting a non-physical or absent pace', () => {
    expect(formatSwimPace(0)).toBe('--:--');
    expect(formatPaceFromSecsPerKm(-1)).toBe('--:--');
    expect(formatPaceCompact(Number.NaN)).toBe('--:--');
  });
});

describe('one duration search behind the power curve readers', () => {
  it('answers null for an empty curve rather than undefined', () => {
    // `number | null` is the declared return, and the hand-rolled closest-match
    // walk fell through to `watts[0]` on an empty `secs`, which is undefined.
    expect(getPowerAtDuration({ secs: [], watts: [] } as unknown as PowerCurve, 60)).toBeNull();
    expect(getIndexAtDuration({ secs: [], watts: [] } as unknown as PowerCurve, 60)).toBeNull();
  });

  it('takes the exact duration when the curve holds it', () => {
    const curve = { secs: [5, 60, 300], watts: [900, 400, 300] } as unknown as PowerCurve;

    expect(getIndexAtDuration(curve, 60)).toBe(1);
    expect(getPowerAtDuration(curve, 60)).toBe(400);
  });

  it('takes the closest duration when it does not, and both agree which', () => {
    const curve = { secs: [5, 60, 300], watts: [900, 400, 300] } as unknown as PowerCurve;

    for (const wanted of [1, 40, 100, 280, 9000]) {
      const index = getIndexAtDuration(curve, wanted);
      expect(index).not.toBeNull();
      expect(getPowerAtDuration(curve, wanted)).toBe(curve.watts[index as number]);
    }
  });

  it('answers null when the curve is absent', () => {
    expect(getPowerAtDuration(undefined, 60)).toBeNull();
    expect(getIndexAtDuration(undefined, 60)).toBeNull();
  });
});
