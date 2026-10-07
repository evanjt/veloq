/**
 * Scenario: the delta plot places the engine's per-lap delta curves on an axis
 * of distance along the section, with the reference as the zero line.
 * Expected behaviour: a lap's path starts at its covered distance, a NaN run is
 * a gap, the newest lap is emphasised unless one is selected, and the scrub
 * snaps to 100 m.
 */

import { layoutDelta, pickEmphasisedLap, snapScrubIndex } from '@/features/routes/lib/deltaLayout';
import type { FfiDirectionDeltas, FfiLapDelta } from 'veloqrs';

const FRAME = { width: 220, height: 120, padding: { left: 10, right: 10, top: 10, bottom: 10 } };
const GRID_STEP_M = 50;
const SECTION_LENGTH_M = 400;

function lap(id: string, date: number, deltaSecs: number[], extra: Partial<FfiLapDelta> = {}) {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: date,
    deltaSecs,
    splitDeltaSecs: [],
    ...extra,
  } as FfiLapDelta;
}

function deltas(laps: FfiLapDelta[]): FfiDirectionDeltas {
  return {
    referenceActivityId: 'ref',
    referenceSource: 0,
    laps,
    missing: [],
  } as FfiDirectionDeltas;
}

/** The subpaths of an SVG path string, each as its list of [x, y] points. */
function subpaths(d: string): number[][][] {
  return d
    .split('M')
    .filter((part) => part.trim() !== '')
    .map((part) =>
      part
        .split('L')
        .map((pair) => pair.trim().split(/\s+/).map(Number))
        .filter((point) => point.length === 2)
    );
}

describe('layoutDelta', () => {
  it('starts a partial lap at its covered distance and breaks the path at a NaN run', () => {
    const partial = lap('partial', 2, [NaN, NaN, 0, 4, NaN, NaN, 5, 6]);
    const plot = layoutDelta(deltas([partial]), GRID_STEP_M, SECTION_LENGTH_M, FRAME, undefined);

    const runs = subpaths(plot.laps[0]!.path);
    expect(runs).toHaveLength(2);
    expect(runs[0]![0]![0]).toBeCloseTo(plot.xForDistance(100));
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]![0]![0]).toBeCloseTo(plot.xForDistance(300));
    expect(plot.laps[0]!.path).not.toMatch(/NaN/);
  });

  it('puts ahead of the reference below the zero line and behind above it', () => {
    const plot = layoutDelta(
      deltas([lap('a', 1, [0, -3, 6])]),
      GRID_STEP_M,
      SECTION_LENGTH_M,
      FRAME,
      undefined
    );
    const points = subpaths(plot.laps[0]!.path)[0]!;

    expect(points[1]![1]).toBeGreaterThan(plot.zeroY);
    expect(points[2]![1]).toBeLessThan(plot.zeroY);
  });

  it('keeps the zero line inside the frame for a lap level with the reference throughout', () => {
    const plot = layoutDelta(
      deltas([lap('a', 1, [0, 0, 0])]),
      GRID_STEP_M,
      SECTION_LENGTH_M,
      FRAME,
      undefined
    );

    expect(Number.isFinite(plot.zeroY)).toBe(true);
    expect(plot.zeroY).toBeGreaterThanOrEqual(FRAME.padding.top);
    expect(plot.zeroY).toBeLessThanOrEqual(FRAME.height - FRAME.padding.bottom);
  });

  it('emphasises the selected lap, else the newest', () => {
    const laps = [lap('old', 1, [0, 1]), lap('new', 3, [0, 2]), lap('mid', 2, [0, 3])];

    expect(pickEmphasisedLap(laps, 'old')?.activityId).toBe('old');
    expect(pickEmphasisedLap(laps, undefined)?.activityId).toBe('new');
    expect(pickEmphasisedLap(laps, 'not-here')?.activityId).toBe('new');
    expect(pickEmphasisedLap([], undefined)).toBeUndefined();

    const plot = layoutDelta(deltas(laps), GRID_STEP_M, SECTION_LENGTH_M, FRAME, 'mid');
    expect(plot.laps.filter((l) => l.emphasised).map((l) => l.activityId)).toEqual(['mid']);
  });
});

describe('snapScrubIndex', () => {
  it('snaps a touch to the nearest 100 m and returns that distance and grid index', () => {
    const plot = layoutDelta(
      deltas([lap('a', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8])]),
      50,
      400,
      FRAME,
      'a'
    );

    const snapped = snapScrubIndex(plot.xForDistance(130), plot, 50);
    expect(snapped).toEqual({ distanceM: 100, index: 2 });
    expect(snapScrubIndex(plot.xForDistance(160), plot, 50)).toEqual({ distanceM: 200, index: 4 });
  });

  it('clamps a touch past either end of the section', () => {
    const plot = layoutDelta(
      deltas([lap('a', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8])]),
      50,
      400,
      FRAME,
      'a'
    );

    expect(snapScrubIndex(-50, plot, 50)).toEqual({ distanceM: 0, index: 0 });
    expect(snapScrubIndex(10_000, plot, 50)).toEqual({ distanceM: 400, index: 8 });
  });
});
