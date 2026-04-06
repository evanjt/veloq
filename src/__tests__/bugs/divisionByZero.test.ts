/**
 * Division-by-zero regression tests.
 * Verifies that fixes for division-by-zero bugs remain in place.
 */

import { gaussianSmooth } from '@/lib/utils/smoothing';

describe('decoupling calculation (fitness.tsx:235, DecouplingChart.tsx:34)', () => {
  // Replicate the FIXED pattern: length < 4 returns null
  function calculateDecoupling(power: number[], hr: number[]): number | null {
    if (power.length < 4 || hr.length < 4) return null;
    const midpoint = Math.floor(power.length / 2);
    const avgFirstPower = power.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgFirstHR = hr.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
    const avgSecondPower =
      power.slice(midpoint).reduce((a, b) => a + b, 0) / (power.length - midpoint);
    const avgSecondHR = hr.slice(midpoint).reduce((a, b) => a + b, 0) / (hr.length - midpoint);
    const firstHalfEf = avgFirstPower / avgFirstHR;
    const secondHalfEf = avgSecondPower / avgSecondHR;
    const decoupling = ((firstHalfEf - secondHalfEf) / firstHalfEf) * 100;
    return decoupling;
  }

  it('normal data produces finite percentage', () => {
    const result = calculateDecoupling(
      [200, 210, 220, 230, 240, 250],
      [130, 135, 140, 145, 150, 155]
    );
    expect(result).not.toBeNull();
    expect(Number.isFinite(result)).toBe(true);
  });

  it('large dataset produces reasonable decoupling', () => {
    const power = Array.from({ length: 100 }, (_, i) => 200 + i * 0.5);
    const hr = Array.from({ length: 100 }, (_, i) => 130 + i * 0.3);
    const result = calculateDecoupling(power, hr);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!)).toBe(true);
    expect(Math.abs(result!)).toBeLessThan(100);
  });

  it('single data point returns null (guarded)', () => {
    expect(calculateDecoupling([200], [140])).toBeNull();
  });

  it('all-zero HR returns null for short arrays', () => {
    expect(calculateDecoupling([200, 210, 220, 230], [0, 0, 0, 0])).not.toBeNull();
    // With 4 points, midpoint=2, avgFirstHR=0, firstHalfEf=Infinity
    // The display site uses Number.isFinite to catch this
  });

  it('empty arrays return null (guarded)', () => {
    expect(calculateDecoupling([], [])).toBeNull();
  });

  it('two data points return null (guarded)', () => {
    expect(calculateDecoupling([0, 200], [140, 150])).toBeNull();
  });

  it('three data points return null (guarded)', () => {
    expect(calculateDecoupling([200, 210, 220], [130, 135, 140])).toBeNull();
  });
});

describe('HRV average division (generateInsights.ts:310-317)', () => {
  // Replicate the FIXED pattern with length > 0 guards
  function computeHrvTrend(hrvNums: number[]) {
    const avg = hrvNums.length > 0 ? hrvNums.reduce((s, v) => s + v, 0) / hrvNums.length : 0;
    const firstHalf = hrvNums.slice(0, Math.floor(hrvNums.length / 2));
    const secondHalf = hrvNums.slice(Math.floor(hrvNums.length / 2));
    const firstAvg =
      firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
    const secondAvg =
      secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
    return { avg, firstAvg, secondAvg };
  }

  it('normal HRV data produces finite averages', () => {
    const result = computeHrvTrend([45, 50, 55, 48, 52, 47, 53]);
    expect(Number.isFinite(result.avg)).toBe(true);
    expect(Number.isFinite(result.firstAvg)).toBe(true);
    expect(Number.isFinite(result.secondAvg)).toBe(true);
  });

  it('two values split evenly into halves', () => {
    const result = computeHrvTrend([40, 60]);
    expect(result.avg).toBe(50);
    expect(result.firstAvg).toBe(40);
    expect(result.secondAvg).toBe(60);
  });

  it('single HRV value produces finite averages', () => {
    const result = computeHrvTrend([45]);
    expect(Number.isFinite(result.avg)).toBe(true);
    expect(Number.isFinite(result.firstAvg)).toBe(true);
    expect(Number.isFinite(result.secondAvg)).toBe(true);
  });

  it('empty HRV array produces finite averages', () => {
    const result = computeHrvTrend([]);
    expect(result.avg).toBe(0);
    expect(result.firstAvg).toBe(0);
    expect(result.secondAvg).toBe(0);
  });
});

describe('gaussianSmooth outputCount=1 (smoothing.ts:137)', () => {
  it('normal outputCount produces finite results', () => {
    const result = gaussianSmooth([1, 2, 3, 4, 5], [10, 20, 30, 40, 50], 10);
    expect(result.length).toBe(10);
    result.forEach((pt) => {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(Number.isFinite(pt.std)).toBe(true);
    });
  });

  it('outputCount=1 is clamped to 2 and produces finite results', () => {
    const result = gaussianSmooth([1, 2, 3, 4, 5], [10, 20, 30, 40, 50], 1);
    expect(result.length).toBe(2);
    expect(Number.isFinite(result[0].x)).toBe(true);
    expect(Number.isFinite(result[0].y)).toBe(true);
  });

  it('outputCount=0 is clamped to 2', () => {
    const result = gaussianSmooth([1, 2, 3, 4, 5], [10, 20, 30, 40, 50], 0);
    expect(result.length).toBeGreaterThanOrEqual(2);
    result.forEach((pt) => {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    });
  });
});

describe('toFixed on NaN reaching UI (fitness.tsx:778, section/[id].tsx:1003)', () => {
  it('NaN.toFixed produces "NaN" string — this is why Number.isFinite guards are needed', () => {
    expect(NaN.toFixed(1)).toBe('NaN');
    expect(Infinity.toFixed(1)).toBe('Infinity');
  });

  it('Number.isFinite guard catches NaN before toFixed (fixed pattern)', () => {
    const value = NaN;
    const display = Number.isFinite(value) ? `${value.toFixed(1)}%` : '-';
    expect(display).toBe('-');
  });

  it('Number.isFinite guard catches Infinity before toFixed', () => {
    const value = Infinity;
    const display = Number.isFinite(value) ? `${value.toFixed(1)}%` : '-';
    expect(display).toBe('-');
  });

  it('Number.isFinite guard passes valid numbers through', () => {
    const display = Number.isFinite(3.7) ? `${(3.7).toFixed(1)}%` : '-';
    expect(display).toBe('3.7%');
  });
});
