/**
 * Plain reading of a correlation coefficient the engine has already computed: a strength band
 * from |r| and the side of zero it sits on. An interval that reaches zero is no clear link
 * whatever r is, so a large r from a small sample is never worded as strong.
 */

export type CorrelationStrength =
  | 'none'
  | 'veryWeak'
  | 'weak'
  | 'moderate'
  | 'strong'
  | 'veryStrong';

export interface CorrelationReading {
  strength: CorrelationStrength;
  /** Which way the input goes when speed rises, or null when there is no clear link. */
  direction: 'higher' | 'lower' | null;
}

const BANDS: [number, CorrelationStrength][] = [
  [0.7, 'veryStrong'],
  [0.5, 'strong'],
  [0.3, 'moderate'],
  [0.1, 'weak'],
];

export function correlationReading(r: number, low: number, high: number): CorrelationReading {
  if (low <= 0 && high >= 0) return { strength: 'none', direction: null };
  const size = Math.abs(r);
  const strength = BANDS.find(([floor]) => size >= floor)?.[1] ?? 'veryWeak';
  return { strength, direction: r > 0 ? 'higher' : 'lower' };
}
