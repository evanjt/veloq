import { formatClimbValue, formatEffortValue } from '@/features/fitness/lib/bestEfforts';

describe('formatEffortValue', () => {
  it('writes cycling power with the supplied watts unit, spaced from the number', () => {
    expect(formatEffortValue(305.4, 'Cycling', 'W', true)).toBe('305 W');
    expect(formatEffortValue(305.4, 'Cycling', 'Вт', true)).toBe('305 Вт');
  });

  it('answers a dash for a missing value', () => {
    expect(formatEffortValue(null, 'Cycling', 'W', true)).toBe('-');
    expect(formatEffortValue(Number.NaN, 'Cycling', 'W', true)).toBe('-');
  });
});

describe('formatEffortValue under the unit preference', () => {
  it('reads a running best per kilometre or per mile', () => {
    expect(formatEffortValue(3.5, 'Running', 'W', true)).toBe('4:46/km');
    expect(formatEffortValue(3.5, 'Running', 'W', false)).toBe('7:40/mi');
  });

  it('reads a swimming best per 100 m or per 100 yd', () => {
    expect(formatEffortValue(1.2, 'Swimming', 'W', true)).toBe('1:23/100m');
    expect(formatEffortValue(1.2, 'Swimming', 'W', false)).toBe('1:16/100yd');
  });
});

describe('formatClimbValue', () => {
  const units = { wattsPerKg: 'W/kg', metresPerHour: 'm/h', feetPerHour: 'ft/h' };
  const best = (windowS: number, vam: number | null, wattsPerKg: number | null) => ({
    label: `${windowS}s`,
    windowS,
    vam,
    wattsPerKg,
    activityId: undefined,
  });

  it('writes a short window as W/kg and a long one as m/h', () => {
    expect(formatClimbValue(best(15, 1800, 4.905), true, units)).toBe('4.91 W/kg');
    expect(formatClimbValue(best(60, 900, 2.4525), true, units)).toBe('2.45 W/kg');
    expect(formatClimbValue(best(300, 1234.4, 3.363), true, units)).toBe('1234 m/h');
    expect(formatClimbValue(best(1200, 800, 2.18), true, units)).toBe('800 m/h');
  });

  it('writes a long window in feet per hour when imperial', () => {
    expect(formatClimbValue(best(600, 1000, 2.7), false, units)).toBe('3281 ft/h');
  });

  it('draws a dash, never NaN, for a window nobody measured', () => {
    expect(formatClimbValue(best(15, null, null), true, units)).toBe('-');
    expect(formatClimbValue(best(300, null, null), true, units)).toBe('-');
    expect(formatClimbValue(best(15, Number.NaN, Number.NaN), true, units)).toBe('-');
    expect(formatClimbValue(best(300, Number.POSITIVE_INFINITY, null), true, units)).toBe('-');
  });
});
