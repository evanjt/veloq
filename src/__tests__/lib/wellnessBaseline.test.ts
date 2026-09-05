/**
 * Scenario: the summary card's arrows compare today against an earlier day, and
 * an athlete who does not log every day has rows that are not days apart.
 * Expected behaviour: a baseline is chosen by date, and no baseline is offered
 * when the gap is wider than the lookback it is meant to cover.
 */
import { baselineOnOrBefore } from '@/features/wellness/lib/wellnessBaseline';
import type { WellnessData } from '@/types';

function rows(...entries: [string, Partial<WellnessData>][]): WellnessData[] {
  return entries
    .map(([id, rest]) => ({ id, ...rest }) as WellnessData)
    .sort((a, b) => b.id.localeCompare(a.id));
}

describe('choosing a baseline row by date', () => {
  it('takes the newest row on or before the lookback date', () => {
    const wellness = rows(
      ['2026-09-05', { ctl: 60 }],
      ['2026-09-04', { ctl: 58 }],
      ['2026-09-03', { ctl: 55 }]
    );

    expect(baselineOnOrBefore(wellness, '2026-09-05', 1)?.id).toBe('2026-09-04');
    expect(baselineOnOrBefore(wellness, '2026-09-05', 2)?.id).toBe('2026-09-03');
  });

  it('reaches back past a gap up to the lookback again, and no further', () => {
    const wellness = rows(['2026-09-05', { ctl: 60 }], ['2026-09-03', { ctl: 55 }]);

    expect(baselineOnOrBefore(wellness, '2026-09-05', 1)?.id).toBe('2026-09-03');
    expect(
      baselineOnOrBefore(rows(['2026-09-05', {}], ['2026-09-02', {}]), '2026-09-05', 1)
    ).toBeUndefined();
  });

  it('offers nothing when the only rows are newer than the lookback date', () => {
    const wellness = rows(['2026-09-05', { ctl: 60 }]);

    expect(baselineOnOrBefore(wellness, '2026-09-05', 1)).toBeUndefined();
  });

  it('skips rows that do not carry the field asked for', () => {
    const wellness = rows(
      ['2026-09-05', { weight: 71 }],
      ['2026-08-29', { ctl: 50 }],
      ['2026-08-28', { weight: 72.4 }]
    );

    expect(baselineOnOrBefore(wellness, '2026-09-05', 7, (w) => w.weight)?.id).toBe('2026-08-28');
  });

  it('offers nothing when every row in the window lacks the field', () => {
    const wellness = rows(['2026-09-05', { weight: 71 }], ['2026-08-29', { ctl: 50 }]);

    expect(baselineOnOrBefore(wellness, '2026-09-05', 7, (w) => w.weight)).toBeUndefined();
  });

  it('handles a single row and an empty list', () => {
    expect(baselineOnOrBefore([], '2026-09-05', 1)).toBeUndefined();
    expect(baselineOnOrBefore(rows(['2026-09-01', {}]), '2026-09-05', 1)).toBeUndefined();
  });

  it('crosses a month boundary by date, not by string arithmetic', () => {
    const wellness = rows(['2026-09-01', { ctl: 60 }], ['2026-08-31', { ctl: 59 }]);

    expect(baselineOnOrBefore(wellness, '2026-09-01', 1)?.id).toBe('2026-08-31');
  });
});
