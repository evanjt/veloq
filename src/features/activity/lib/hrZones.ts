export const DEFAULT_MAX_HR = 190;

// Max HR is a divisor in the zone math; API and local settings can both carry
// 0 or garbage. Resolve to the first positive finite value, then the default.
export function resolveMaxHR(apiMaxHR: number | undefined, localMaxHR: number): number {
  if (typeof apiMaxHR === 'number' && Number.isFinite(apiMaxHR) && apiMaxHR > 0) return apiMaxHR;
  if (Number.isFinite(localMaxHR) && localMaxHR > 0) return localMaxHR;
  return DEFAULT_MAX_HR;
}
