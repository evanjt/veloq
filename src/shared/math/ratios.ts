/**
 * Variability Index (VI = normalized power / average power). Returns null when
 * average power is zero or either input is non-finite, so a caller never renders
 * Infinity or NaN from a divide-by-zero.
 */
export function variabilityIndex(
  normalizedPower?: number | null,
  averagePower?: number | null
): number | null {
  if (!Number.isFinite(normalizedPower as number) || !Number.isFinite(averagePower as number)) {
    return null;
  }
  if ((averagePower as number) === 0) return null;
  return (normalizedPower as number) / (averagePower as number);
}

/**
 * Efficiency Factor (EF = normalized power / average heart rate). Same null
 * guard as VI: a zero or non-finite HR yields null, not Infinity/NaN.
 */
export function efficiencyFactor(
  normalizedPower?: number | null,
  averageHeartrate?: number | null
): number | null {
  if (!Number.isFinite(normalizedPower as number) || !Number.isFinite(averageHeartrate as number)) {
    return null;
  }
  if ((averageHeartrate as number) === 0) return null;
  return (normalizedPower as number) / (averageHeartrate as number);
}
