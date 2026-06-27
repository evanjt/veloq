export interface DecouplingAnalysis {
  firstHalfEf: number;
  secondHalfEf: number;
  decoupling: number;
  isGood: boolean;
}

// Returns null when decoupling cannot be computed (too little data, or a half
// with no usable HR/power), so callers show the empty state instead of NaN.
export function calculateDecoupling(
  power: number[],
  heartrate: number[]
): DecouplingAnalysis | null {
  if (power.length < 4 || heartrate.length < 4) return null;

  const midpoint = Math.floor(power.length / 2);

  // Calculate efficiency (power/HR) for each half
  const firstHalfPower = power.slice(0, midpoint);
  const firstHalfHR = heartrate.slice(0, midpoint);
  const secondHalfPower = power.slice(midpoint);
  const secondHalfHR = heartrate.slice(midpoint);

  const avgFirstPower = firstHalfPower.reduce((a, b) => a + b, 0) / firstHalfPower.length;
  const avgFirstHR = firstHalfHR.reduce((a, b) => a + b, 0) / firstHalfHR.length;
  const avgSecondPower = secondHalfPower.reduce((a, b) => a + b, 0) / secondHalfPower.length;
  const avgSecondHR = secondHalfHR.reduce((a, b) => a + b, 0) / secondHalfHR.length;

  if (!Number.isFinite(avgFirstHR) || avgFirstHR <= 0) return null;
  if (!Number.isFinite(avgSecondHR) || avgSecondHR <= 0) return null;

  const firstHalfEf = avgFirstPower / avgFirstHR;
  const secondHalfEf = avgSecondPower / avgSecondHR;
  if (!Number.isFinite(firstHalfEf) || !Number.isFinite(secondHalfEf) || firstHalfEf <= 0) {
    return null;
  }

  // Decoupling percentage: how much efficiency dropped
  const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;
  if (!Number.isFinite(decoupling)) return null;

  // < 5% decoupling is considered good aerobic fitness
  const isGood = decoupling < 5;

  return { firstHalfEf, secondHalfEf, decoupling, isGood };
}
