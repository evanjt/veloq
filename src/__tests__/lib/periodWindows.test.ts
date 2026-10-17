import { seasonWindows, seasonMonthChange, seasonChange } from '@/features/stats/lib/periodWindows';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('seasonWindows', () => {
  it('reads last year from 1 January to the same elapsed span', () => {
    const w = seasonWindows(new Date(2026, 8, 24));
    expect([ymd(w.yearCurrent.start), ymd(w.yearCurrent.end)]).toEqual([
      '2026-01-01',
      '2026-09-24',
    ]);
    expect([ymd(w.yearPrevious.start), ymd(w.yearPrevious.end)]).toEqual([
      '2025-01-01',
      '2025-09-24',
    ]);
    expect([ymd(w.monthCurrent.start), ymd(w.monthCurrent.end)]).toEqual([
      '2026-09-01',
      '2026-09-24',
    ]);
    expect([ymd(w.monthPrevious.start), ymd(w.monthPrevious.end)]).toEqual([
      '2025-09-01',
      '2025-09-24',
    ]);
  });

  it('caps the previous month at its length on 29 February', () => {
    const w = seasonWindows(new Date(2024, 1, 29));
    expect(ymd(w.monthPrevious.end)).toBe('2023-02-28');
  });
});

describe('seasonMonthChange', () => {
  const bar = (current: number, previous: number) => ({ current, previous });
  const toDate = { current: 10, previous: 10 };

  it('shows no percentage for a month after the current one', () => {
    expect(seasonMonthChange(10, 8, bar(0, 50), toDate)).toBeNull();
  });

  it('compares the current month to the same day last year', () => {
    expect(seasonMonthChange(8, 8, bar(10, 50), { current: 10, previous: 10 })).toBe(0);
    expect(seasonMonthChange(8, 8, bar(10, 50), { current: 15, previous: 10 })).toBe(50);
  });

  it('compares a past month whole against whole', () => {
    expect(seasonMonthChange(3, 8, bar(5, 10), toDate)).toBe(-50);
  });

  it('shows none when the baseline is zero', () => {
    expect(seasonMonthChange(3, 8, bar(5, 0), toDate)).toBeNull();
  });
});

describe('seasonChange', () => {
  it.each([0, 0.3, -0.3, 0.49, -0.49])('prints a %s% change as 0% on the neutral rung', (pct) => {
    expect(seasonChange('hours', pct)).toEqual({ text: '0%', rung: 'neutral' });
  });

  it('signs a rise and a fall once rounded', () => {
    expect(seasonChange('hours', 12.4)).toEqual({ text: '+12%', rung: 'positive' });
    expect(seasonChange('distance', -50)).toEqual({ text: '-50%', rung: 'negative' });
    expect(seasonChange('hours', 0.5)).toEqual({ text: '+1%', rung: 'positive' });
  });

  it('draws load, which moves with no judgement, on the neutral rung either way', () => {
    expect(seasonChange('tss', 30)).toEqual({ text: '+30%', rung: 'neutral' });
    expect(seasonChange('tss', -30)).toEqual({ text: '-30%', rung: 'neutral' });
  });
});
