/**
 * Scenario: with smoothing on, a wellness row draws the window mean, so a 62 ms
 * HRV spike under a 7-day window sits on the line at about 46.
 *
 * Expected behaviour: the readout prints the day's own reading, the scrub dot
 * sits on the drawn line at that day, and the row states the low and high of
 * its readings and their period average.
 */

import {
  wellnessRowDomain,
  wellnessRowMarker,
  wellnessRowReading,
  wellnessRowStats,
} from '@/features/wellness/lib/wellnessRow';
import { smoothDataPoints } from '@/shared/math/smoothing';

const HRV = [44, 45, 43, 62, 44, 46, 45, 43, 44, 45];

function points(readings: number[], skip: number[] = []) {
  return readings
    .map((reading, x) => ({
      x,
      date: `2026-03-${String(x + 1).padStart(2, '0')}`,
      value: reading,
      rawValue: reading,
    }))
    .filter((d) => !skip.includes(d.x));
}

describe('wellnessRowReading', () => {
  it('states the scrubbed day’s own reading under smoothing, not the window mean', () => {
    const smoothed = smoothDataPoints(points(HRV), 7);
    expect(smoothed[3].value).not.toBeCloseTo(62);

    expect(wellnessRowReading(smoothed, 3)).toEqual({ x: 3, date: '2026-03-04', value: 62 });
  });

  it('states the reading unchanged when smoothing is off', () => {
    expect(wellnessRowReading(smoothDataPoints(points(HRV), 0), 3)?.value).toBe(62);
  });

  it('states the newest reading at rest', () => {
    const smoothed = smoothDataPoints(points(HRV), 7);
    expect(wellnessRowReading(smoothed, null)).toEqual({ x: 9, date: '2026-03-10', value: 45 });
  });

  it('states nothing for a scrubbed day the metric was not logged on', () => {
    const smoothed = smoothDataPoints(points(HRV, [5]), 7);
    expect(wellnessRowReading(smoothed, 5)).toBeNull();
  });

  it('states nothing for a row with no readings', () => {
    expect(wellnessRowReading([], null)).toBeNull();
    expect(wellnessRowReading([], 2)).toBeNull();
  });
});

describe('wellnessRowMarker', () => {
  it('sits on the smoothed line at the scrubbed day, not at the day’s reading', () => {
    const smoothed = smoothDataPoints(points(HRV), 7);
    const marker = wellnessRowMarker(smoothed, 3);
    expect(marker).toEqual({ x: 3, value: smoothed[3].value });
    expect(marker?.value).not.toBeCloseTo(62);
  });

  it('sits at the reading itself when smoothing is off', () => {
    expect(wellnessRowMarker(smoothDataPoints(points(HRV), 0), 3)).toEqual({ x: 3, value: 62 });
  });

  it('draws no dot for a scrubbed day the metric was not logged on', () => {
    expect(wellnessRowMarker(smoothDataPoints(points(HRV, [5]), 7), 5)).toBeNull();
  });

  it('draws no dot at rest', () => {
    expect(wellnessRowMarker(smoothDataPoints(points(HRV), 7), null)).toBeNull();
  });
});

describe('wellnessRowStats', () => {
  it('states the low, high and average of the day readings, not of the smoothed line', () => {
    const smoothed = smoothDataPoints(points(HRV), 7);
    const stats = wellnessRowStats(smoothed);
    expect(stats).not.toBeNull();
    expect(stats!.low).toBe(43);
    expect(stats!.high).toBe(62);
    expect(stats!.average).toBeCloseTo(46.1);
  });

  it('states nothing for a row with no readings', () => {
    expect(wellnessRowStats([])).toBeNull();
  });
});

describe('wellnessRowDomain', () => {
  it('holds every raw reading under smoothing, so a scrubbed dot stays inside its row', () => {
    const smoothed = smoothDataPoints(points(HRV), 7);
    const { min, max } = wellnessRowDomain(smoothed);
    for (const d of smoothed) {
      expect(d.rawValue).toBeGreaterThanOrEqual(min);
      expect(d.rawValue).toBeLessThanOrEqual(max);
      expect(d.value).toBeGreaterThanOrEqual(min);
      expect(d.value).toBeLessThanOrEqual(max);
    }
  });

  it('pads a flat row so it still has a height to draw in', () => {
    const { min, max } = wellnessRowDomain(points([50, 50, 50]));
    expect(min).toBeLessThan(50);
    expect(max).toBeGreaterThan(50);
  });
});
