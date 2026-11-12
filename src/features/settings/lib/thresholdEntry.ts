import { parseDecimalInput } from '@/shared/format/decimalInput';

/** What a threshold field holds once the athlete leaves it. */
export type ThresholdEntry =
  { kind: 'unchanged' } | { kind: 'clear' } | { kind: 'set'; value: number } | { kind: 'invalid' };

/**
 * Reads a threshold field the athlete has finished with. An empty field clears
 * the athlete's own figure when there is one and otherwise changes nothing. Text
 * that is not a positive number is invalid, and a figure equal to the one the
 * athlete already set changes nothing.
 */
export function readThresholdEntry(text: string, athleteValue: number | null): ThresholdEntry {
  if (text.trim() === '') return athleteValue === null ? { kind: 'unchanged' } : { kind: 'clear' };
  const value = parseDecimalInput(text);
  if (value === null || value <= 0) return { kind: 'invalid' };
  return value === athleteValue ? { kind: 'unchanged' } : { kind: 'set', value };
}
