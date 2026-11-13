import { safeGetTime } from '@/shared/format/format';

describe('safeGetTime', () => {
  it('returns a real timestamp for a valid date', () => {
    expect(safeGetTime(new Date('2026-01-15'))).toBe(Date.UTC(2026, 0, 15));
  });

  it.each([
    ['Invalid Date', new Date('invalid')],
    ['null', null],
    ['undefined', undefined],
  ])('returns 0 for %s so comparators stay total', (_label, input) => {
    expect(safeGetTime(input as Date | null | undefined)).toBe(0);
  });

  it('orders invalid dates last rather than leaving the sort undefined', () => {
    const items = [
      { date: new Date('invalid') },
      { date: new Date('2026-01-15') },
      { date: new Date('2026-01-10') },
    ];
    const sorted = [...items].sort((a, b) => safeGetTime(b.date) - safeGetTime(a.date));
    expect(sorted.map((i) => safeGetTime(i.date))).toEqual([
      Date.UTC(2026, 0, 15),
      Date.UTC(2026, 0, 10),
      0,
    ]);
  });
});
