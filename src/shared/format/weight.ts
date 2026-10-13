import { ABSENT } from './absent';
import { formatDecimal, formatDecimalTrimmed } from './number';

export const KG_TO_LB = 2.20462;

/** Convert kilograms to the athlete's display unit. */
export function toDisplayWeight(kg: number, isMetric: boolean): number {
  return isMetric ? kg : kg * KG_TO_LB;
}

export function weightUnitLabel(isMetric: boolean): string {
  return isMetric ? 'kg' : 'lbs';
}

/** Integers stay integer; fractional values get one decimal. */
export function formatWeight(kg: number, isMetric: boolean): string {
  if (!Number.isFinite(kg)) return ABSENT;
  const value = toDisplayWeight(kg, isMetric);
  const text = value % 1 === 0 ? formatDecimal(value, 0) : formatDecimal(value, 1);
  return `${text} ${weightUnitLabel(isMetric)}`;
}

export function formatWeightRounded(kg: number, isMetric: boolean): string {
  return `${formatDecimal(Math.round(toDisplayWeight(kg, isMetric)), 0)} ${weightUnitLabel(isMetric)}`;
}

/** One decimal, no space before the unit, for the home card's narrow slot. */
export function formatWeightCompact(kg: number, isMetric: boolean): string {
  return `${formatDecimalTrimmed(toDisplayWeight(kg, isMetric), 1)}${weightUnitLabel(isMetric)}`;
}
