import {
  likeForLikeWindows,
  seasonWindows,
  seasonMonthChange,
} from '@/features/stats/lib/periodWindows';
import { weeklyTrend } from '@/features/stats/lib/weeklyTrend';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const span = (w: {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}) => [ymd(w.currentStart), ymd(w.currentEnd), ymd(w.previousStart), ymd(w.previousEnd)];

describe('likeForLikeWindows', () => {
  it('ends the previous week on the same weekday', () => {
    // Wednesday 24 September 2025
    expect(span(likeForLikeWindows('week', new Date(2025, 8, 24, 15)))).toEqual([
      '2025-09-22',
      '2025-09-24',
      '2025-09-15',
      '2025-09-17',
    ]);
  });

  it('compares a month a day old with the first day of the month before', () => {
    expect(span(likeForLikeWindows('month', new Date(2025, 8, 2)))).toEqual([
      '2025-09-01',
      '2025-09-02',
      '2025-08-01',
      '2025-08-02',
    ]);
  });

  it('caps the previous window at the end of a shorter month', () => {
    expect(span(likeForLikeWindows('month', new Date(2025, 4, 31)))[3]).toBe('2025-04-30');
  });

  it('keeps a window whose current period is whole at the whole previous period', () => {
    // 3m on the last day of a month still only reaches the same elapsed span
    const w = likeForLikeWindows('3m', new Date(2025, 8, 30));
    expect(ymd(w.currentStart)).toBe('2025-07-01');
    expect(ymd(w.previousStart)).toBe('2025-04-01');
    expect(ymd(w.previousEnd)).toBe('2025-06-30');
  });

  it('ends the previous 6 month and year windows after the same elapsed days', () => {
    expect(span(likeForLikeWindows('6m', new Date(2025, 8, 5)))).toEqual([
      '2025-04-01',
      '2025-09-05',
      '2024-10-01',
      '2025-03-07',
    ]);
    expect(span(likeForLikeWindows('year', new Date(2025, 8, 24)))).toEqual([
      '2025-01-01',
      '2025-09-24',
      '2024-01-01',
      '2024-09-23',
    ]);
  });

  it('shows no move for flat training early in a month', () => {
    // 10 h in the first two days of each month, steady
    const w = likeForLikeWindows('month', new Date(2025, 8, 2));
    const hours = (start: Date, end: Date) =>
      (Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1) * 5;
    const current = hours(w.currentStart, w.currentEnd) * 3600;
    const previous = hours(w.previousStart, w.previousEnd) * 3600;
    expect(weeklyTrend('duration', current, previous)?.pct).toBeNull();
  });
});

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
