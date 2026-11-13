import { formatDaySpan } from '@/shared/format';

const t = (key: string, { count }: { count: number }) => `${key}:${count}`;

describe('formatDaySpan', () => {
  it.each([
    [1, 'time.daysCount:1'],
    [364, 'time.daysCount:364'],
    [365, 'time.yearsCount:1'],
    [730, 'time.yearsCount:2'],
    [2916, 'time.yearsCount:8'],
  ])('reads %i days as %s', (days, expected) => {
    expect(formatDaySpan(days, t)).toBe(expected);
  });
});
