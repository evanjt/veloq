import {
  getFormZone,
  formatForm,
  formZoneFromLoads,
  type FormZone,
} from '@/features/fitness/lib/fitness';

describe('getFormZone', () => {
  const testCases: { tsb: number; expected: FormZone }[] = [
    // highRisk zone (TSB < -30)
    { tsb: -50, expected: 'highRisk' },
    { tsb: -40, expected: 'highRisk' },
    { tsb: -31, expected: 'highRisk' },

    // optimal zone (-30 <= TSB < -10)
    { tsb: -30, expected: 'optimal' },
    { tsb: -20, expected: 'optimal' },
    { tsb: -11, expected: 'optimal' },

    // greyZone zone (-10 <= TSB < 5)
    { tsb: -10, expected: 'greyZone' },
    { tsb: 0, expected: 'greyZone' },
    { tsb: 4, expected: 'greyZone' },

    // Fresh zone (5 <= TSB < 25)
    { tsb: 5, expected: 'fresh' },
    { tsb: 15, expected: 'fresh' },
    { tsb: 24, expected: 'fresh' },

    // transition zone (TSB >= 25)
    { tsb: 25, expected: 'transition' },
    { tsb: 30, expected: 'transition' },
    { tsb: 50, expected: 'transition' },
  ];

  it('maps TSB to the correct form zone across all boundaries', () => {
    for (const { tsb, expected } of testCases) {
      expect(getFormZone(tsb)).toBe(expected);
    }
  });
});

/**
 * Scenario: loads either side of a half unit, so the unrounded difference sits
 * across a boundary from the rounded form every surface prints.
 *
 * Expected behaviour: the zone is the one the printed number falls in, rounded
 * fitness minus rounded fatigue against rounded fitness.
 */
describe('formZoneFromLoads', () => {
  it.each<[number, number, FormZone]>([
    [60.4, 90.45, 'optimal'],
    [60.4, 70.45, 'greyZone'],
    [50.4, 45.45, 'fresh'],
    [70.4, 45.45, 'transition'],
  ])('ctl %d and atl %d zone the printed absolute form as %s', (ctl, atl, expected) => {
    expect(formZoneFromLoads(ctl, atl, false)).toBe(expected);
  });

  it.each<[number, number, FormZone]>([
    [99.6, 130.4, 'optimal'],
    [100.4, 110.45, 'greyZone'],
    [100.4, 95.45, 'fresh'],
    [100.4, 75.45, 'transition'],
  ])('ctl %d and atl %d zone the printed percentage as %s', (ctl, atl, expected) => {
    expect(formZoneFromLoads(ctl, atl, true)).toBe(expected);
  });

  it('has no percentage zone when fitness rounds to zero, as the printed form has no number', () => {
    expect(formZoneFromLoads(0.4, 3, true)).toBeNull();
    expect(formatForm(-3, 0, true)).toBeNull();
    expect(formZoneFromLoads(0.4, 3, false)).toBe('greyZone');
  });

  it('reads a missing load as zero, as the printed form does', () => {
    expect(formZoneFromLoads(null, 50, false)).toBe('highRisk');
    expect(formZoneFromLoads(null, 50, true)).toBeNull();
  });
});

describe('formatForm', () => {
  it('prints the percentage of fitness with a suffix, in the zone getFormZone names', () => {
    expect(formatForm(-8, 40, true)).toBe('-20%');
    expect(getFormZone(-8, 40, true)).toBe('optimal');
    expect(formatForm(10, 40, true)).toBe('+25%');
    expect(formatForm(0, 40, true)).toBe('0%');
  });

  it('prints the absolute TSB, signed, when the percentage setting is off', () => {
    expect(formatForm(-8, 40, false)).toBe('-8');
    expect(formatForm(5, 40, false)).toBe('+5');
    expect(formatForm(0, 40)).toBe('0');
  });

  it('prints no number for a day with no fitness under the percentage setting', () => {
    expect(formatForm(-8, 0, true)).toBeNull();
    expect(formatForm(-8, null, true)).toBeNull();
    expect(formatForm(-8, undefined, true)).toBeNull();
    expect(formatForm(-8, 0, false)).toBe('-8');
  });

  it('rounds the percentage to an integer, and a rounding to zero carries no sign', () => {
    expect(formatForm(-1, 300, true)).toBe('0%');
    expect(formatForm(1, 300, true)).toBe('0%');
    expect(formatForm(-7.2, 40, true)).toBe('-18%');
  });
});
