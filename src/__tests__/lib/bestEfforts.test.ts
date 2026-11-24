import { formatClimbValue, formatEffortValue } from '@/features/fitness/lib/bestEfforts';
import { ABSENT } from '@/shared/format/absent';

const effort = (
  value: number | null,
  paceMetricText: string | null = null,
  paceImperialText: string | null = null
) => ({ value, paceMetricText, paceImperialText });

describe('formatEffortValue', () => {
  it('writes cycling power with the supplied watts unit, spaced from the number', () => {
    expect(formatEffortValue(effort(305.4), 'Cycling', 'W', true)).toBe('305 W');
    expect(formatEffortValue(effort(305.4), 'Cycling', 'Вт', true)).toBe('305 Вт');
  });

  it('answers the absent mark for a missing value', () => {
    expect(formatEffortValue(effort(null), 'Cycling', 'W', true)).toBe(ABSENT);
    expect(formatEffortValue(effort(Number.NaN), 'Cycling', 'W', true)).toBe(ABSENT);
  });
});

describe('formatEffortValue under the unit preference', () => {
  it('reads a running best per kilometre or per mile', () => {
    const run = effort(3.5, '9:99', '8:88');
    expect(formatEffortValue(run, 'Running', 'W', true)).toBe('9:99/km');
    expect(formatEffortValue(run, 'Running', 'W', false)).toBe('8:88/mi');
  });

  it('answers the absent mark for a running best the engine gave no text for', () => {
    expect(formatEffortValue(effort(3.5), 'Running', 'W', true)).toBe(ABSENT);
  });

  it('reads a swimming best per 100 m or per 100 yd from the engine text', () => {
    const swim = effort(1.2, '7:77', '6:66');
    expect(formatEffortValue(swim, 'Swimming', 'W', true)).toBe('7:77/100m');
    expect(formatEffortValue(swim, 'Swimming', 'W', false)).toBe('6:66/100yd');
  });

  it('answers the absent mark for a swimming best the engine gave no text for', () => {
    expect(formatEffortValue(effort(1.2), 'Swimming', 'W', true)).toBe(ABSENT);
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
    activity: undefined,
  });

  it('writes a short window as W/kg and a long one as m/h', () => {
    expect(formatClimbValue(best(15, 1800, 4.905), true, units)).toBe('4.91 W/kg');
    expect(formatClimbValue(best(60, 900, 2.4525), true, units)).toBe('2.45 W/kg');
    expect(formatClimbValue(best(300, 1234.4, 3.363), true, units)).toBe('1,234 m/h');
    expect(formatClimbValue(best(1200, 800, 2.18), true, units)).toBe('800 m/h');
  });

  it('writes a long window in feet per hour when imperial', () => {
    expect(formatClimbValue(best(600, 1000, 2.7), false, units)).toBe('3,281 ft/h');
  });

  it('draws the absent mark, never NaN, for a window nobody measured', () => {
    expect(formatClimbValue(best(15, null, null), true, units)).toBe(ABSENT);
    expect(formatClimbValue(best(300, null, null), true, units)).toBe(ABSENT);
    expect(formatClimbValue(best(15, Number.NaN, Number.NaN), true, units)).toBe(ABSENT);
    expect(formatClimbValue(best(300, Number.POSITIVE_INFINITY, null), true, units)).toBe(ABSENT);
  });
});
