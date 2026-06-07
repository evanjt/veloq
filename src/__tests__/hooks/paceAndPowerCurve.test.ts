/**
 * Tests for pure utility functions exported from usePaceCurve and usePowerCurve.
 * These are non-hook exports that can be tested without React.
 */

import {
  paceToMinPerKm,
  paceToMinPer100m,
  getPaceAtDistance,
  getIndexAtDistance,
  getTimeAtDistance,
  PACE_CURVE_DISTANCES,
  SWIM_PACE_CURVE_DISTANCES,
} from '@/features/stats/hooks/usePaceCurve';

import {
  getPowerAtDuration,
  getIndexAtDuration,
  formatPowerCurveForChart,
  POWER_CURVE_DURATIONS,
} from '@/features/stats/hooks/usePowerCurve';

import type { PaceCurve, PowerCurve } from '@/types';

// ---------------------------------------------------------------------------
// paceToMinPerKm
// ---------------------------------------------------------------------------

describe('paceToMinPerKm', () => {
  it('converts m/s to min/km across the running pace range', () => {
    // pace = 1000 / speed seconds per km, split into minutes/seconds.
    const cases: { secondsPerKm: number; minutes: number; seconds: number }[] = [
      { secondsPerKm: 240, minutes: 4, seconds: 0 }, // 4:00
      { secondsPerKm: 390, minutes: 6, seconds: 30 }, // 6:30
      { secondsPerKm: 120, minutes: 2, seconds: 0 }, // very fast
      { secondsPerKm: 900, minutes: 15, seconds: 0 }, // very slow
    ];

    for (const { secondsPerKm, minutes, seconds } of cases) {
      const result = paceToMinPerKm(1000 / secondsPerKm);
      expect(result.minutes).toBe(minutes);
      expect(result.seconds).toBe(seconds);
    }
  });

  it('returns {0, 0} for zero and negative speed', () => {
    expect(paceToMinPerKm(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(paceToMinPerKm(-5)).toEqual({ minutes: 0, seconds: 0 });
  });

  it('rolls over seconds=60 to next minute', () => {
    // We need a speed where Math.round(secondsPerKm % 60) === 60
    // secondsPerKm % 60 >= 59.5 means secondsPerKm = N*60 + 59.5
    // e.g. secondsPerKm = 359.5 → minutes should be 6, seconds 0 (not 5:60)
    const secondsPerKm = 359.5;
    const metersPerSecond = 1000 / secondsPerKm;
    const result = paceToMinPerKm(metersPerSecond);
    expect(result.seconds).toBeLessThan(60);
    // 359.5s → floor(359.5/60) = 5, round(359.5 % 60) = round(59.5) = 60 → rollover → 6:00
    expect(result.minutes).toBe(6);
    expect(result.seconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// paceToMinPer100m
// ---------------------------------------------------------------------------

describe('paceToMinPer100m', () => {
  it('converts a typical swim pace (1:40/100m = 1.0 m/s)', () => {
    const result = paceToMinPer100m(1.0);
    expect(result.minutes).toBe(1);
    expect(result.seconds).toBe(40);
  });

  it('rolls over seconds=60 to next minute', () => {
    // secondsPer100m = 100 / speed; we need secondsPer100m % 60 >= 59.5
    // e.g. secondsPer100m = 119.5 → 100/119.5 m/s
    const secondsPer100m = 119.5;
    const metersPerSecond = 100 / secondsPer100m;
    const result = paceToMinPer100m(metersPerSecond);
    expect(result.seconds).toBeLessThan(60);
    expect(result.minutes).toBe(2);
    expect(result.seconds).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getPaceAtDistance
// ---------------------------------------------------------------------------

describe('getPaceAtDistance', () => {
  const mockCurve: PaceCurve = {
    type: 'pace',
    sport: 'Run',
    distances: [400, 800, 1000, 5000, 10000],
    times: [65, 140, 180, 1050, 2200],
    pace: [6.15, 5.71, 5.56, 4.76, 4.55],
  };

  it('returns null for undefined curve or curve missing the pace array', () => {
    const noPace = { type: 'pace', sport: 'Run', distances: [100], times: [20] } as PaceCurve;
    expect(getPaceAtDistance(undefined, 1000)).toBeNull();
    expect(getPaceAtDistance(noPace, 100)).toBeNull();
  });

  it('returns the pace at the closest distance', () => {
    // Exact, within-1m tolerance, nearest entry, and beyond-range all snap to the
    // closest distance's pace value.
    const cases: { distance: number; expected: number }[] = [
      { distance: 1000, expected: 5.56 }, // exact
      { distance: 1000.5, expected: 5.56 }, // within 1m tolerance
      { distance: 900, expected: 5.71 }, // nearest is 800m
      { distance: 50000, expected: 4.55 }, // beyond range -> nearest 10000m
    ];

    for (const { distance, expected } of cases) {
      expect(getPaceAtDistance(mockCurve, distance)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// getIndexAtDistance
// ---------------------------------------------------------------------------

describe('getIndexAtDistance', () => {
  const mockCurve: PaceCurve = {
    type: 'pace',
    sport: 'Run',
    distances: [400, 800, 1000, 5000, 10000],
    times: [65, 140, 180, 1050, 2200],
    pace: [6.15, 5.71, 5.56, 4.76, 4.55],
  };

  it('returns null for undefined curve', () => {
    expect(getIndexAtDistance(undefined, 1000)).toBeNull();
  });

  it('returns the index of the closest distance, keeping the first when tied', () => {
    const cases: { distance: number; index: number }[] = [
      { distance: 800, index: 1 }, // exact
      { distance: 800.3, index: 1 }, // within tolerance
      { distance: 700, index: 1 }, // nearest 800m (diff 100 < 300)
      { distance: 600, index: 0 }, // equidistant 400/800 -> first
      { distance: 10, index: 0 }, // below range -> first
    ];

    for (const { distance, index } of cases) {
      expect(getIndexAtDistance(mockCurve, distance)).toBe(index);
    }
  });
});

// ---------------------------------------------------------------------------
// getTimeAtDistance
// ---------------------------------------------------------------------------

describe('getTimeAtDistance', () => {
  const mockCurve: PaceCurve = {
    type: 'pace',
    sport: 'Run',
    distances: [400, 800, 1000, 5000],
    times: [65, 140, 180, 1050],
    pace: [6.15, 5.71, 5.56, 4.76],
  };

  it('returns null for undefined curve', () => {
    expect(getTimeAtDistance(undefined, 1000)).toBeNull();
  });

  it('returns the time at the closest distance', () => {
    expect(getTimeAtDistance(mockCurve, 1000)).toBe(180); // exact
    // 900 is equidistant from 800 and 1000 (diff 100); first closest at idx 1 -> 140
    expect(getTimeAtDistance(mockCurve, 900)).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// getPowerAtDuration
// ---------------------------------------------------------------------------

describe('getPowerAtDuration', () => {
  const mockCurve: PowerCurve = {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200, 3600],
    watts: [1200, 450, 320, 280, 250],
  };

  it('returns null for undefined curve or curve with no secs', () => {
    const noSecs = { type: 'power', sport: 'Ride' } as PowerCurve;
    expect(getPowerAtDuration(undefined, 60)).toBeNull();
    expect(getPowerAtDuration(noSecs, 60)).toBeNull();
  });

  it('returns the power at the closest duration', () => {
    const cases: { duration: number; expected: number }[] = [
      { duration: 300, expected: 320 }, // exact
      { duration: 250, expected: 320 }, // nearest 300 (diff 50 < 190)
      { duration: 1, expected: 1200 }, // very short -> first
      { duration: 99999, expected: 250 }, // very long -> last
    ];

    for (const { duration, expected } of cases) {
      expect(getPowerAtDuration(mockCurve, duration)).toBe(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// getIndexAtDuration
// ---------------------------------------------------------------------------

describe('getIndexAtDuration', () => {
  const mockCurve: PowerCurve = {
    type: 'power',
    sport: 'Ride',
    secs: [5, 60, 300, 1200, 3600],
    watts: [1200, 450, 320, 280, 250],
  };

  it('returns null for undefined curve', () => {
    expect(getIndexAtDuration(undefined, 60)).toBeNull();
  });

  it('returns the index of the closest duration', () => {
    expect(getIndexAtDuration(mockCurve, 1200)).toBe(3); // exact
    expect(getIndexAtDuration(mockCurve, 100)).toBe(1); // nearest 60 (diff 40 < 200)
  });
});

// ---------------------------------------------------------------------------
// formatPowerCurveForChart
// ---------------------------------------------------------------------------

describe('formatPowerCurveForChart', () => {
  it('returns empty array for undefined curve', () => {
    expect(formatPowerCurveForChart(undefined)).toEqual([]);
  });

  it('returns entries with undefined power for curve with empty arrays', () => {
    // When secs/watts are empty arrays (truthy), getPowerAtDuration falls through
    // to closest-match logic which returns undefined (not null), so filter(d !== null)
    // doesn't remove them. This is actual behavior — entries have power: undefined.
    const emptyCurve: PowerCurve = { type: 'power', sport: 'Ride', secs: [], watts: [] };
    const result = formatPowerCurveForChart(emptyCurve);
    expect(result).toHaveLength(POWER_CURVE_DURATIONS.length);
  });

  it('maps POWER_CURVE_DURATIONS to chart data', () => {
    // Create a curve with data at standard durations
    const curve: PowerCurve = {
      type: 'power',
      sport: 'Ride',
      secs: [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200],
      watts: [1200, 1000, 800, 500, 400, 350, 320, 290, 270, 250, 230],
    };
    const result = formatPowerCurveForChart(curve);
    expect(result).toHaveLength(POWER_CURVE_DURATIONS.length);
    expect(result[0]).toEqual({ secs: 5, label: '5s', power: 1200 });
    expect(result[result.length - 1]).toEqual({ secs: 7200, label: '2h', power: 230 });
  });

  it('each entry has secs, label, and power fields', () => {
    const curve: PowerCurve = {
      type: 'power',
      sport: 'Ride',
      secs: [5, 60, 300],
      watts: [1000, 400, 300],
    };
    const result = formatPowerCurveForChart(curve);
    result.forEach((entry) => {
      expect(entry).toHaveProperty('secs');
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('power');
      expect(typeof entry.secs).toBe('number');
      expect(typeof entry.label).toBe('string');
      expect(typeof entry.power).toBe('number');
    });
  });
});

// ---------------------------------------------------------------------------
// Constant arrays
// ---------------------------------------------------------------------------

describe('PACE_CURVE_DISTANCES', () => {
  it('has entries for standard running distances', () => {
    const labels = PACE_CURVE_DISTANCES.map((d) => d.label);
    expect(labels).toContain('400m');
    expect(labels).toContain('5K');
    expect(labels).toContain('10K');
    expect(labels).toContain('Half');
  });

  it('distances are in ascending order', () => {
    for (let i = 1; i < PACE_CURVE_DISTANCES.length; i++) {
      expect(PACE_CURVE_DISTANCES[i].meters).toBeGreaterThan(PACE_CURVE_DISTANCES[i - 1].meters);
    }
  });
});

describe('SWIM_PACE_CURVE_DISTANCES', () => {
  it('has entries for standard swimming distances', () => {
    const labels = SWIM_PACE_CURVE_DISTANCES.map((d) => d.label);
    expect(labels).toContain('100m');
    expect(labels).toContain('400m');
    expect(labels).toContain('1500m');
  });
});

describe('POWER_CURVE_DURATIONS', () => {
  it('has entries for standard durations', () => {
    const labels = POWER_CURVE_DURATIONS.map((d) => d.label);
    expect(labels).toContain('5s');
    expect(labels).toContain('1m');
    expect(labels).toContain('5m');
    expect(labels).toContain('20m');
    expect(labels).toContain('1h');
  });
});
