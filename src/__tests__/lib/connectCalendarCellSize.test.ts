/**
 * Scenario: a calendar holds a full year and a short one beside it, and the
 * card is narrower than the full year at its largest cell.
 *
 * Expected behaviour: every year draws with the cell the longest row fits, so
 * a short year is never drawn larger than a full one.
 */

import { calendarCellSize } from '../../../web/connect/charts/scale';

describe('calendarCellSize', () => {
  it('takes one size from the longest row, however short the others are', () => {
    const size = calendarCellSize(600, [53, 9]);
    expect(size).toBe(calendarCellSize(600, [53]));
    expect(size).toBeLessThan(calendarCellSize(600, [9]));
  });

  it('fits the longest row inside the width', () => {
    const size = calendarCellSize(600, [53, 20]);
    expect(28 + 53 * (size + 2)).toBeLessThanOrEqual(600);
  });

  it('stays between the smallest and largest cell', () => {
    expect(calendarCellSize(100, [53])).toBe(6);
    expect(calendarCellSize(5000, [10])).toBe(14);
  });

  it('gives the largest cell when there are no rows', () => {
    expect(calendarCellSize(600, [])).toBe(14);
  });
});
