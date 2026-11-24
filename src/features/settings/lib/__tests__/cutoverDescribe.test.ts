import { describeCutoverCounts, describeSettingsReset } from '../cutoverDescribe';

const t = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}${JSON.stringify(vars)}` : key;

const counts = (over: Record<string, number> = {}) => ({
  current: 40,
  proposed: 42,
  unchanged: 35,
  changed: 3,
  new: 4,
  gone: 2,
  ...over,
});

describe('describeCutoverCounts', () => {
  it('reports the totals and the breakdown when sections moved', () => {
    const line = describeCutoverCounts(counts(), t);
    expect(line).toMatch(/diffTotals/);
    expect(line).toMatch(/diffBreakdown/);
    expect(line).toMatch(/new\\?":4/);
    expect(line).toMatch(/gone\\?":2/);
  });

  it('reads a catalogue that came through untouched as unchanged', () => {
    const line = describeCutoverCounts(
      counts({ proposed: 40, unchanged: 40, changed: 0, new: 0, gone: 0 }),
      t
    );
    expect(line).toMatch(/diffUnchanged/);
    expect(line).toMatch(/"count":40/);
  });

  it('says the detector kept none of the library rather than showing totals', () => {
    const line = describeCutoverCounts(
      counts({ current: 60, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 60 }),
      t
    );
    expect(line).toMatch(/diffNoneKept/);
    expect(line).toMatch(/"count":60/);
    expect(line).not.toMatch(/diffTotals/);
  });

  it('reads an empty library as unchanged, not as kept none', () => {
    const line = describeCutoverCounts(
      counts({ current: 0, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 0 }),
      t
    );
    expect(line).toMatch(/diffUnchanged/);
    expect(line).not.toMatch(/diffNoneKept/);
  });
});

describe('describeSettingsReset', () => {
  const settings = {
    proximityThreshold: 100,
    minSectionLength: 50,
    maxSectionLength: 200000,
    minActivities: 3,
    divergenceThreshold: 0.1,
  };

  it('names only the values that moved, with their units', () => {
    const line = describeSettingsReset(
      {
        previous: settings,
        current: {
          ...settings,
          proximityThreshold: 200,
          minActivities: 2,
          divergenceThreshold: 0.15,
        },
      },
      t
    );
    expect(line).toMatch(/settingsResetProximity/);
    expect(line).toMatch(/"from":"100 m","to":"200 m"/);
    expect(line).toMatch(/"from":"3","to":"2"/);
    expect(line).toMatch(/settingsResetDivergence/);
    expect(line).not.toMatch(/settingsResetMaxLength/);
    expect(line).not.toMatch(/settingsResetMinLength/);
  });

  it('is empty when nothing moved', () => {
    expect(describeSettingsReset({ previous: settings, current: settings }, t)).toBe('');
  });
});
