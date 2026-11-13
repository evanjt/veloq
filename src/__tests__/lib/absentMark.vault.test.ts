/**
 * Expected behaviour: a value the data does not carry prints one mark, and a
 * screen reader hears it as "no data" rather than as minus or dash, whether
 * the mark fills a cell or sits inside a line of other figures.
 */

import { ABSENT, absentLabel } from '@/shared/format/absent';

const t = (key: string) => (key === 'common.noData' ? 'No data' : key);

it('speaks a cell holding only the mark as no data', () => {
  expect(absentLabel(ABSENT, t)).toBe('No data');
});

it('speaks the mark inside a line and leaves the rest of the line alone', () => {
  expect(absentLabel(`4.2 km · 2 rides · ${ABSENT}`, t)).toBe('4.2 km · 2 rides · No data');
});

it('gives no label to text that carries a value', () => {
  expect(absentLabel('12 reps', t)).toBeUndefined();
  expect(absentLabel('-3 W', t)).toBeUndefined();
  expect(absentLabel('--:--', t)).toBeUndefined();
});
