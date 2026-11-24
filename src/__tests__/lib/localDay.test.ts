import { addLocalDays } from '@/shared/time/localDay';

describe('addLocalDays', () => {
  it('moves a date back across a month boundary', () => {
    expect(addLocalDays(new Date(2026, 2, 1, 9, 30), -1)).toEqual(new Date(2026, 1, 28, 9, 30));
  });

  it('moves a date forward across a year boundary', () => {
    expect(addLocalDays(new Date(2026, 11, 31, 23, 0), 1)).toEqual(new Date(2027, 0, 1, 23, 0));
  });

  it('keeps the wall-clock time across a daylight-saving change', () => {
    const shifted = addLocalDays(new Date(2026, 2, 28, 12, 0), 2);
    expect(shifted.getDate()).toBe(30);
    expect(shifted.getHours()).toBe(12);
  });

  it('reads whole weeks as seven days each', () => {
    expect(addLocalDays(new Date(2026, 5, 10, 8), -3 * 7)).toEqual(new Date(2026, 4, 20, 8));
  });

  it('returns a separate date when the shift is zero', () => {
    const date = new Date(2026, 5, 10, 8);
    const shifted = addLocalDays(date, 0);
    expect(shifted).toEqual(date);
    expect(shifted).not.toBe(date);
  });

  it('leaves the date it was given unchanged', () => {
    const date = new Date(2026, 5, 10, 8);
    addLocalDays(date, -27);
    expect(date).toEqual(new Date(2026, 5, 10, 8));
  });
});
