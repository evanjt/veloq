/**
 * Expected behaviour: a best set prints the figures it carries. A body-weight
 * set has repetitions and no load, so it reads as its repetitions alone rather
 * than as a 0 kg lift.
 */

import { formatBestSet } from '@/features/strength/lib/formatting';
import { ABSENT } from '@/shared/format/absent';

const t = (key: string, values?: { count?: number }) =>
  key === 'strength.repsCount' ? `${values?.count} reps` : key;

it('prints the load and the repetitions of a loaded set', () => {
  expect(formatBestSet({ weightKg: 60, repetitions: 8 }, true, t)).toBe('60 kg · 8 reps');
});

it('prints the repetitions alone for a set with no load', () => {
  expect(formatBestSet({ weightKg: undefined, repetitions: 12 }, true, t)).toBe('12 reps');
  expect(formatBestSet({ weightKg: undefined, repetitions: 12 }, false, t)).toBe('12 reps');
});

it('prints the load alone for a set with no repetitions', () => {
  expect(formatBestSet({ weightKg: 40, repetitions: undefined }, false, t)).toBe('88.2 lbs');
});

it('prints the absent mark for a set that carries neither', () => {
  expect(formatBestSet({ weightKg: undefined, repetitions: undefined }, true, t)).toBe(ABSENT);
});
