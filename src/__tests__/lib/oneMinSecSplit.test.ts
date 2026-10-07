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
import { getIndexAtDuration } from '@/features/stats/hooks/usePowerCurve';
import type { PowerCurve } from '@/types';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';

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
    expect(formatPaceFromSecsPerKm(119.7, true)).toBe(formatMinSec(119.7));
    expect(formatPaceFromSecsPerKm(330, true)).toBe(formatMinSec(330));
  });

  it('agrees with formatMinSec on a speed, compact and with a unit', () => {
    const metresPerSecond = 1000 / 330;
    expect(formatPaceCompact(metresPerSecond, true)).toBe(formatMinSec(330));
    expect(formatPace(metresPerSecond, true)).toBe(`${formatMinSec(330)} /km`);
  });

  it('agrees with formatMinSec on swim pace per 100 m', () => {
    const metresPerSecond = 100 / 95;
    expect(formatSwimPace(metresPerSecond, true)).toBe(formatMinSec(95));
  });

  it('carries the swim-pace rounding the same way, at 119.5 s per 100 m', () => {
    // Was `paceToMinPer100m`'s own case before that formatter was collapsed
    // into `formatSwimPace`: the remainder rounds to 60 and must carry.
    expect(formatSwimPace(100 / 119.5, true)).toBe('2:00');
  });

  it('keeps rejecting a non-physical or absent pace', () => {
    expect(formatSwimPace(0, true)).toBe('--:--');
    expect(formatPaceFromSecsPerKm(-1, true)).toBe('--:--');
    expect(formatPaceCompact(Number.NaN, true)).toBe('--:--');
  });
});

describe('duration search behind the power curve readers', () => {
  it('answers null for an empty curve rather than undefined', () => {
    expect(getIndexAtDuration({ secs: [], watts: [] } as unknown as PowerCurve, 60)).toBeNull();
  });

  it('takes the exact duration when the curve holds it', () => {
    const curve = { secs: [5, 60, 300], watts: [900, 400, 300] } as unknown as PowerCurve;

    expect(getIndexAtDuration(curve, 60)).toBe(1);
  });

  it('takes the closest duration when it does not', () => {
    const curve = { secs: [5, 60, 300], watts: [900, 400, 300] } as unknown as PowerCurve;

    expect(getIndexAtDuration(curve, 1)).toBe(0);
    expect(getIndexAtDuration(curve, 100)).toBe(1);
    expect(getIndexAtDuration(curve, 9000)).toBe(2);
  });

  it('answers null when the curve is absent', () => {
    expect(getIndexAtDuration(undefined, 60)).toBeNull();
  });
});

describe('the activity chart pace formatters share that split', () => {
  // Minutes per km, as the pace and GAP streams carry them. 4.995 is 4 min
  // 59.7 s, which the hand-rolled split printed as "4:60".
  it.each([
    [4.995, '5:00'],
    [1.995, '2:00'],
    [2.9917, '3:00'],
    [5.5, '5:30'],
    [0, '0:00'],
  ])('formats %d min as %s on the pace and GAP charts', (minutes, expected) => {
    expect(CHART_CONFIGS.pace.formatValue?.(minutes, true)).toBe(expected);
    expect(CHART_CONFIGS.gap.formatValue?.(minutes, true)).toBe(expected);
  });

  it('never emits a seconds field of 60 on either chart', () => {
    for (let tenths = 0; tenths <= 6000; tenths++) {
      const minutes = tenths / 600;
      for (const config of [CHART_CONFIGS.pace, CHART_CONFIGS.gap]) {
        const formatted = config.formatValue?.(minutes, true) ?? '';
        expect(formatted).toBe(formatMinSec(minutes * 60));
      }
    }
  });
});
