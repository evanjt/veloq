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
  const value = toDisplayWeight(kg, isMetric);
  const text = value % 1 === 0 ? `${value}` : value.toFixed(1);
  return `${text} ${weightUnitLabel(isMetric)}`;
}

export function formatWeightRounded(kg: number, isMetric: boolean): string {
  return `${Math.round(toDisplayWeight(kg, isMetric))} ${weightUnitLabel(isMetric)}`;
}

/** One decimal, no space before the unit, for the home card's narrow slot. */
export function formatWeightCompact(kg: number, isMetric: boolean): string {
  return `${Math.round(toDisplayWeight(kg, isMetric) * 10) / 10}${weightUnitLabel(isMetric)}`;
}
