/**
 * Property-based invariants for the numeric core. fast-check throws thousands of
 * arbitrary inputs (including NaN, +/-Infinity, negatives, and extremes) at the
 * pure calculation and formatting helpers and asserts the physical invariants
 * hold: speed and pace are grounded in distance/time, conversions are
 * reversible, and no banned token ever reaches the UI.
 */

import * as fc from 'fast-check';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatElevation,
  formatTemperature,
  formatHeartRate,
  formatPower,
  formatLoad,
  formatCalories,
} from '@/shared/format/format';
import { calculateSpeed, paceMinutesFromSpeed } from '@/shared/math';

const BANNED = ['NaN', 'Infinity', '-Infinity', 'undefined', 'null'];

// Any number a formatter might receive: ordinary doubles plus the values that
// historically leaked into the UI.
const messyNumber = fc.oneof(
  fc.double(),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.constant(0),
  fc.constant(-1)
);

const finitePositive = fc.double({
  min: 0.001,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('format functions never leak a banned token', () => {
  const single: [string, (v: number) => string][] = [
    ['formatDistance', (v) => formatDistance(v, true)],
    ['formatDistance/imperial', (v) => formatDistance(v, false)],
    ['formatDuration', (v) => formatDuration(v)],
    ['formatSpeed', (v) => formatSpeed(v, true)],
    ['formatSpeed/imperial', (v) => formatSpeed(v, false)],
    ['formatElevation', (v) => formatElevation(v, true)],
    ['formatTemperature', (v) => formatTemperature(v, true)],
    ['formatHeartRate', (v) => formatHeartRate(v)],
    ['formatPower', (v) => formatPower(v)],
    ['formatLoad', (v) => formatLoad(v)],
    ['formatCalories', (v) => formatCalories(v)],
  ];

  it('holds for every formatter across arbitrary input', () => {
    for (const [, fn] of single) {
      fc.assert(
        fc.property(messyNumber, (v) => {
          const out = fn(v);
          for (const token of BANNED) expect(out).not.toContain(token);
        })
      );
    }
  });
});

describe('calculateSpeed', () => {
  it('is always finite and non-negative', () => {
    fc.assert(
      fc.property(messyNumber, messyNumber, (dist, time) => {
        const s = calculateSpeed(dist, time);
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('inverts to distance for positive inputs (s = d/t implies s*t = d)', () => {
    fc.assert(
      fc.property(finitePositive, finitePositive, (dist, time) => {
        const s = calculateSpeed(dist, time);
        expect(s * time).toBeCloseTo(dist, 4);
      })
    );
  });

  it('returns 0 for non-positive time', () => {
    fc.assert(
      fc.property(messyNumber, fc.double({ min: -1000, max: 0, noNaN: true }), (dist, time) => {
        expect(calculateSpeed(dist, time)).toBe(0);
      })
    );
  });
});

describe('paceMinutesFromSpeed', () => {
  it('is always finite and non-negative for any speed', () => {
    fc.assert(
      fc.property(messyNumber, (mps) => {
        const pace = paceMinutesFromSpeed(mps);
        expect(Number.isFinite(pace)).toBe(true);
        expect(pace).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('inverts to speed for positive input (ref / (pace * 60) recovers m/s)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }), (mps) => {
        const pace = paceMinutesFromSpeed(mps);
        expect(1000 / (pace * 60)).toBeCloseTo(mps, 4);
      })
    );
  });

  it('scales linearly with the reference distance (swim 100m basis)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }), (mps) => {
        expect(paceMinutesFromSpeed(mps, 100)).toBeCloseTo(paceMinutesFromSpeed(mps) / 10, 8);
      })
    );
  });

  it('returns 0 for non-positive, non-finite, or overflowing speed', () => {
    // 5e-324 is the smallest denormal: 1000 / 5e-324 overflows to Infinity.
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity, -5, 0, 5e-324), (mps) => {
        expect(paceMinutesFromSpeed(mps)).toBe(0);
      })
    );
  });
});
