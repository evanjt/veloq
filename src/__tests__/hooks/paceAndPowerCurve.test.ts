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
} from '@/hooks/charts/usePaceCurve';

import {
  getPowerAtDuration,
  getIndexAtDuration,
  formatPowerCurveForChart,
  POWER_CURVE_DURATIONS,
} from '@/hooks/charts/usePowerCurve';

import type { PaceCurve, PowerCurve } from '@/types';

// ---------------------------------------------------------------------------
// paceToMinPerKm
// ---------------------------------------------------------------------------

describe('paceToMinPerKm', () => {
  it('converts a typical running pace (4:00/km = 4.1667 m/s)', () => {
    // 1000 / 4.1667 ≈ 240s → 4:00
    const result = paceToMinPerKm(1000 / 240);
    expect(result.minutes).toBe(4);
    expect(result.seconds).toBe(0);
  });

  it('converts a slower pace (6:30/km)', () => {
    // 6:30 = 390s/km → 1000/390 ≈ 2.564 m/s
    const result = paceToMinPerKm(1000 / 390);
    expect(result.minutes).toBe(6);
    expect(result.seconds).toBe(30);
  });

  it('returns {0, 0} for zero speed', () => {
    expect(paceToMinPerKm(0)).toEqual({ minutes: 0, seconds: 0 });
  });

  it('returns {0, 0} for negative speed', () => {
    expect(paceToMinPerKm(-5)).toEqual({ minutes: 0, seconds: 0 });
  });

  it('handles very fast speed (2:00/km)', () => {
    const result = paceToMinPerKm(1000 / 120);
    expect(result.minutes).toBe(2);
    expect(result.seconds).toBe(0);
  });

  it('handles very slow speed (15:00/km)', () => {
    const result = paceToMinPerKm(1000 / 900);
    expect(result.minutes).toBe(15);
    expect(result.seconds).toBe(0);
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

  it('returns {0, 0} for zero speed', () => {
    expect(paceToMinPer100m(0)).toEqual({ minutes: 0, seconds: 0 });
  });

  it('returns {0, 0} for negative speed', () => {
    expect(paceToMinPer100m(-2)).toEqual({ minutes: 0, seconds: 0 });
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

  it('returns null for undefined curve', () => {
    expect(getPaceAtDistance(undefined, 1000)).toBeNull();
  });

  it('returns null for curve with empty distances', () => {
    const emptyCurve: PaceCurve = {
      type: 'pace',
      sport: 'Run',
      distances: [],
      times: [],
      pace: [],
    };
    expect(getPaceAtDistance(emptyCurve, 1000)).toBeNull();
  });

  it('finds exact distance match', () => {
    expect(getPaceAtDistance(mockCurve, 1000)).toBe(5.56);
  });

  it('finds near-exact match within 1m tolerance', () => {
    expect(getPaceAtDistance(mockCurve, 1000.5)).toBe(5.56);
  });

  it('finds closest distance when no exact match', () => {
    // 900m is closest to 800m
    expect(getPaceAtDistance(mockCurve, 900)).toBe(5.71);
  });

  it('returns closest match for distance beyond range', () => {
    expect(getPaceAtDistance(mockCurve, 50000)).toBe(4.55); // closest to 10000
  });

  it('returns null for curve with missing pace array', () => {
    const noPace = { type: 'pace', sport: 'Run', distances: [100], times: [20] } as PaceCurve;
    expect(getPaceAtDistance(noPace, 100)).toBeNull();
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

  it('returns null for empty distances', () => {
    const emptyCurve: PaceCurve = {
      type: 'pace',
      sport: 'Run',
      distances: [],
      times: [],
      pace: [],
    };
    expect(getIndexAtDistance(emptyCurve, 1000)).toBeNull();
  });

  it('returns exact index for exact match', () => {
    expect(getIndexAtDistance(mockCurve, 800)).toBe(1);
  });

  it('returns exact index for near-match within tolerance', () => {
    expect(getIndexAtDistance(mockCurve, 800.3)).toBe(1);
  });

  it('returns closest index for non-exact distance', () => {
    // 700 is between 400 (diff=300) and 800 (diff=100) → closest is 800 at idx 1
    expect(getIndexAtDistance(mockCurve, 700)).toBe(1);
  });

  it('returns first closest when equidistant', () => {
    // 600 is equidistant from 400 (diff=200) and 800 (diff=200) → keeps first, idx 0
    expect(getIndexAtDistance(mockCurve, 600)).toBe(0);
  });

  it('returns first index for distance below range', () => {
    expect(getIndexAtDistance(mockCurve, 10)).toBe(0);
  });

  it('returns last index for distance above range', () => {
    expect(getIndexAtDistance(mockCurve, 99999)).toBe(4);
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

  it('returns null for curve with no times', () => {
    const noTimes = { type: 'pace', sport: 'Run', distances: [100] } as PaceCurve;
    expect(getTimeAtDistance(noTimes, 100)).toBeNull();
  });

  it('returns time at exact distance', () => {
    expect(getTimeAtDistance(mockCurve, 1000)).toBe(180);
  });

  it('returns time at closest distance', () => {
    // 900 → closest is 1000 (idx 2) → time 180
    expect(getTimeAtDistance(mockCurve, 900)).toBe(140); // 900 is closer to 800 (diff 100) than 1000 (diff 100), picks first closest at index 1
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

  it('returns null for undefined curve', () => {
    expect(getPowerAtDuration(undefined, 60)).toBeNull();
  });

  it('returns null for curve with no secs', () => {
    const noSecs = { type: 'power', sport: 'Ride' } as PowerCurve;
    expect(getPowerAtDuration(noSecs, 60)).toBeNull();
  });

  it('returns exact match power', () => {
    expect(getPowerAtDuration(mockCurve, 300)).toBe(320);
  });

  it('returns closest match for non-exact duration', () => {
    // 250 is between 60 (diff=190) and 300 (diff=50) → closest is 300
    expect(getPowerAtDuration(mockCurve, 250)).toBe(320);
  });

  it('returns first entry power for very short duration', () => {
    expect(getPowerAtDuration(mockCurve, 1)).toBe(1200);
  });

  it('returns last entry power for very long duration', () => {
    expect(getPowerAtDuration(mockCurve, 99999)).toBe(250);
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

  it('returns null for empty secs', () => {
    const emptyCurve: PowerCurve = { type: 'power', sport: 'Ride', secs: [], watts: [] };
    expect(getIndexAtDuration(emptyCurve, 60)).toBeNull();
  });

  it('returns exact index', () => {
    expect(getIndexAtDuration(mockCurve, 1200)).toBe(3);
  });

  it('returns closest index for non-exact duration', () => {
    // 100 is between 60 (diff=40) and 300 (diff=200) → closest is 60 at idx 1
    expect(getIndexAtDuration(mockCurve, 100)).toBe(1);
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

  it('distances are in ascending order', () => {
    for (let i = 1; i < SWIM_PACE_CURVE_DISTANCES.length; i++) {
      expect(SWIM_PACE_CURVE_DISTANCES[i].meters).toBeGreaterThan(
        SWIM_PACE_CURVE_DISTANCES[i - 1].meters
      );
    }
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

  it('durations are in ascending order', () => {
    for (let i = 1; i < POWER_CURVE_DURATIONS.length; i++) {
      expect(POWER_CURVE_DURATIONS[i].secs).toBeGreaterThan(POWER_CURVE_DURATIONS[i - 1].secs);
    }
  });
});
