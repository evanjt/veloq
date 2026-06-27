/**
 * Variability Index (NP/AP) and Efficiency Factor (NP/HR) must return null, not
 * Infinity or NaN, when their denominator is 0 or any input is non-finite. The
 * power-metrics hook drops the detail row when the helper returns null, so a
 * zero-power or zero-HR activity never shows a garbage ratio.
 */

import { variabilityIndex, efficiencyFactor } from '@/shared/math/ratios';

describe('variabilityIndex (NP / AP)', () => {
  it('computes the ratio for finite positive inputs', () => {
    expect(variabilityIndex(220, 200)).toBeCloseTo(1.1, 6);
  });

  it('returns null when average power is 0 (no Infinity)', () => {
    expect(variabilityIndex(220, 0)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(variabilityIndex(NaN, 200)).toBeNull();
    expect(variabilityIndex(220, NaN)).toBeNull();
    expect(variabilityIndex(Infinity, 200)).toBeNull();
    expect(variabilityIndex(220, Infinity)).toBeNull();
  });

  it('returns null for null/undefined inputs', () => {
    expect(variabilityIndex(null, 200)).toBeNull();
    expect(variabilityIndex(220, undefined)).toBeNull();
  });
});

describe('efficiencyFactor (NP / HR)', () => {
  it('computes the ratio for finite positive inputs', () => {
    expect(efficiencyFactor(225, 150)).toBeCloseTo(1.5, 6);
  });

  it('returns null when average heart rate is 0 (no Infinity)', () => {
    expect(efficiencyFactor(225, 0)).toBeNull();
  });

  it('returns null for non-finite inputs', () => {
    expect(efficiencyFactor(NaN, 150)).toBeNull();
    expect(efficiencyFactor(225, NaN)).toBeNull();
    expect(efficiencyFactor(Infinity, 150)).toBeNull();
    expect(efficiencyFactor(225, Infinity)).toBeNull();
  });

  it('returns null for null/undefined inputs', () => {
    expect(efficiencyFactor(null, 150)).toBeNull();
    expect(efficiencyFactor(225, undefined)).toBeNull();
  });
});
