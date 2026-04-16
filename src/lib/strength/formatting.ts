import type { StrengthBalancePair } from '@/types';

/**
 * Format a weight value in kg or lbs depending on the user's metric preference.
 * Integer values stay integer; fractional values get one decimal.
 * Used for detail views where precision matters.
 */
export function formatWeight(kg: number, isMetric: boolean): string {
  if (isMetric) {
    return kg % 1 === 0 ? `${kg} kg` : `${kg.toFixed(1)} kg`;
  }
  const lbs = kg * 2.20462;
  return lbs % 1 === 0 ? `${lbs} lbs` : `${lbs.toFixed(1)} lbs`;
}

/**
 * Format a weight value rounded to the nearest integer.
 * Used for at-a-glance insight displays where precision isn't needed.
 */
export function formatWeightRounded(kg: number, isMetric: boolean): string {
  if (isMetric) return `${Math.round(kg)} kg`;
  return `${Math.round(kg * 2.20462)} lbs`;
}

/** Format a set count: integers stay integer, fractions get one decimal. */
export function formatSetCount(sets: number): string {
  return sets % 1 === 0 ? sets.toFixed(0) : sets.toFixed(1);
}

/** Format a balance ratio (e.g., 1.2x). Falls back to em-dash when unavailable. */
export function formatBalanceRatio(pair: StrengthBalancePair): string {
  if (pair.ratio == null || !Number.isFinite(pair.ratio)) return '\u2014';
  return `${pair.ratio.toFixed(pair.ratio >= 10 ? 0 : 1)}x`;
}
