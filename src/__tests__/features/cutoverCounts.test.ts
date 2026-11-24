import { describeCutoverCounts } from '@/features/settings/lib/cutoverCounts';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${JSON.stringify(vars ?? {})}`;
const base = { current: 40, proposed: 42, unchanged: 35, changed: 3, new: 4, gone: 2 };

describe('describeCutoverCounts', () => {
  it('reports the totals and the breakdown when sections moved', () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    describeCutoverCounts(base, (key, vars) => {
      calls.push([key, vars]);
      return key;
    });
    expect(calls).toContainEqual(['whatsNew.v040.diffTotals', { current: 40, proposed: 42 }]);
    expect(calls).toContainEqual(['whatsNew.v040.diffBreakdown', { new: 4, changed: 3, gone: 2 }]);
  });

  it('reads a catalogue that came through untouched as unchanged', () => {
    const line = describeCutoverCounts(
      { ...base, proposed: 40, unchanged: 40, changed: 0, new: 0, gone: 0 },
      t
    );
    expect(line).toBe('whatsNew.v040.diffUnchanged{"count":40}');
  });

  it('reads an empty library as unchanged, not as kept none', () => {
    const line = describeCutoverCounts(
      { current: 0, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 0 },
      t
    );
    expect(line).toContain('diffUnchanged');
    expect(line).not.toContain('diffNoneKept');
  });

  it('says the detector kept none of the library', () => {
    const line = describeCutoverCounts(
      { current: 60, proposed: 0, unchanged: 0, changed: 0, new: 0, gone: 60 },
      t
    );
    expect(line).toBe('whatsNew.v040.diffNoneKept{"count":60}');
  });

  it('reports totals when the re-cut kept some sections', () => {
    const line = describeCutoverCounts(
      { current: 60, proposed: 9, unchanged: 5, changed: 2, new: 2, gone: 55 },
      t
    );
    expect(line).toContain('diffTotals');
    expect(line).not.toContain('diffNoneKept');
  });
});
