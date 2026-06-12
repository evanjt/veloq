/**
 * Property-based invariants for the numeric core. fast-check throws thousands of
 * arbitrary inputs (including NaN, +/-Infinity, negatives, and extremes) at the
 * pure calculation and formatting helpers and asserts the physical invariants
 * hold: speed and pace are grounded in distance/time, conversions are
 * reversible, and no banned token ever reaches the UI.
 */

import fc from 'fast-check';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatElevation,
  formatTemperature,
  formatHeartRate,
  formatPower,
  formatTSS,
  formatCalories,
  formatSwimPace,
  speedToSecsPerKm,
} from '@/shared/format/format';
import { calculateSpeed, paceMinutesFromSpeed, tsbFromLoads } from '@/shared/math';
import { getFormZone } from '@/features/fitness/lib/fitness';

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
const finiteNumber = fc.double({
  min: -100_000,
  max: 100_000,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('format functions never leak a banned token', () => {
  const single: [string, (v: number) => string][] = [
    ['formatDistance', (v) => formatDistance(v)],
    ['formatDistance/imperial', (v) => formatDistance(v, false)],
    ['formatDuration', (v) => formatDuration(v)],
    ['formatPace', (v) => formatPace(v)],
    ['formatPace/imperial', (v) => formatPace(v, false)],
    ['formatSwimPace', (v) => formatSwimPace(v)],
    ['formatSpeed', (v) => formatSpeed(v)],
    ['formatSpeed/imperial', (v) => formatSpeed(v, false)],
    ['formatElevation', (v) => formatElevation(v)],
    ['formatTemperature', (v) => formatTemperature(v)],
    ['formatHeartRate', (v) => formatHeartRate(v)],
    ['formatPower', (v) => formatPower(v)],
    ['formatTSS', (v) => formatTSS(v)],
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
    // 5e-324 is the denormal that turned formatPace into "Infinity:NaN".
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity, -5, 0, 5e-324), (mps) => {
        expect(paceMinutesFromSpeed(mps)).toBe(0);
      })
    );
  });
});

describe('speedToSecsPerKm', () => {
  it('inverts for positive speed (1000/spk recovers m/s)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 30, noNaN: true, noDefaultInfinity: true }), (mps) => {
        const spk = speedToSecsPerKm(mps);
        expect(1000 / spk).toBeCloseTo(mps, 4);
      })
    );
  });

  it('coerces invalid speed to 0, never NaN', () => {
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity, -5, 0), (mps) => {
        const spk = speedToSecsPerKm(mps);
        expect(Number.isNaN(spk)).toBe(false);
      })
    );
  });
});

describe('tsbFromLoads', () => {
  it('equals ctl - atl for finite inputs and null otherwise', () => {
    fc.assert(
      fc.property(messyNumber, messyNumber, (ctl, atl) => {
        const r = tsbFromLoads(ctl, atl);
        if (Number.isFinite(ctl) && Number.isFinite(atl)) {
          expect(r).toBe(ctl - atl);
        } else {
          expect(r).toBeNull();
        }
      })
    );
  });
});

describe('getFormZone', () => {
  const ZONES = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'];

  it('maps every finite TSB to exactly one valid zone', () => {
    fc.assert(
      fc.property(finiteNumber, (tsb) => {
        expect(ZONES).toContain(getFormZone(tsb));
      })
    );
  });

  it('partitions at the -30 / -10 / 5 / 25 boundaries with no gaps', () => {
    const cases: [number, string][] = [
      [-31, 'highRisk'],
      [-30, 'optimal'],
      [-11, 'optimal'],
      [-10, 'greyZone'],
      [4, 'greyZone'],
      [5, 'fresh'],
      [24, 'fresh'],
      [25, 'transition'],
    ];
    for (const [tsb, zone] of cases) expect(getFormZone(tsb)).toBe(zone);
  });
});
