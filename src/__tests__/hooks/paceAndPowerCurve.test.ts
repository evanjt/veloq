/**
 * Tests for pure utility functions exported from usePaceCurve and usePowerCurve.
 * These are non-hook exports that can be tested without React.
 */

import { getIndexAtDistance, getTimeAtDistance } from '@/features/stats/hooks/usePaceCurve';

import { getIndexAtDuration } from '@/features/stats/hooks/usePowerCurve';

import type { PaceCurve, PowerCurve } from '@/types';

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
