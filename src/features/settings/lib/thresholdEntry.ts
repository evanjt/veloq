import { parseDecimalInput } from '@/shared/format/decimalInput';
import { KG_TO_LB, toDisplayWeight } from '@/shared/format/weight';

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

/** The figure as the athlete's unit shows it: weight converts from kilograms, the rest passes through. */
export function toThresholdDisplay(isWeight: boolean, value: number, isMetric: boolean): number {
  return isWeight ? toDisplayWeight(value, isMetric) : value;
}

/** The inverse of {@link toThresholdDisplay}: what the athlete typed, back in the stored unit. */
export function fromThresholdDisplay(isWeight: boolean, value: number, isMetric: boolean): number {
  return isWeight && !isMetric ? value / KG_TO_LB : value;
}
