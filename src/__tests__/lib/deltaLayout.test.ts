/**
 * Scenario: the delta plot places the engine's per-lap delta curves on an axis
 * of distance along the section, with the reference as the zero line.
 * Expected behaviour: a lap's path starts at its covered distance, a NaN run is
 * a gap, the newest lap is emphasised unless one is selected, and the scrub
 * snaps to 100 m.
 */

import {
  layoutDelta,
  pickEmphasisedLap,
  scrubDeltaSecs,
  snapScrubIndex,
} from '@/features/routes/lib/deltaLayout';
import type { FfiDirectionDeltas, FfiLapDelta } from 'veloqrs';

const FRAME = { width: 220, height: 120, padding: { left: 10, right: 10, top: 10, bottom: 10 } };
const GRID_STEP_M = 50;
const SECTION_LENGTH_M = 400;

function lap(id: string, date: number, deltaSecs: number[], extra: Partial<FfiLapDelta> = {}) {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: date,
    deltaSecs: Float32Array.from(deltaSecs),
    splitDeltaSecs: new Float32Array(0),
    ...extra,
  } as FfiLapDelta;
}

/** The direction's laps with the peak the engine computes over them. */
function deltas(laps: FfiLapDelta[]): FfiDirectionDeltas {
  let peakDeltaSecs = 0;
  for (const each of laps) {
    for (const secs of each.deltaSecs) {
      if (Number.isFinite(secs)) peakDeltaSecs = Math.max(peakDeltaSecs, Math.abs(secs));
    }
  }
  return {
    referenceActivityId: 'ref',
    referenceSource: 0,
    laps,
    missing: [],
    peakDeltaSecs,
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

  it('scales the y axis to the peak the engine computed for the direction', () => {
    const direction = { ...deltas([lap('a', 1, [0, 2, 3])]), peakDeltaSecs: 9 };
    const plot = layoutDelta(direction, GRID_STEP_M, SECTION_LENGTH_M, FRAME, undefined);

    expect(plot.extentSecs).toBe(9);
  });

  describe('a 40 km curve on a 10 m grid', () => {
    const POINTS = 4_001;
    const values = Array.from({ length: POINTS }, (_, i) =>
      i < 25 ? NaN : Math.sin(i / 7) * 20 + (i % 13) * 0.37
    );
    // A one-point surge well inside a pixel column.
    values[2_002] = 55.5;
    const long = lap('long', 1, values);
    const plotWidth = FRAME.width - FRAME.padding.left - FRAME.padding.right;
    const plot = layoutDelta(deltas([long]), 10, (POINTS - 1) * 10, FRAME, undefined);
    const runs = subpaths(plot.laps[0]!.path);

    it('draws at most two points a pixel column', () => {
      const segments = runs.reduce((sum, run) => sum + run.length - 1, 0);
      expect(segments).toBeLessThanOrEqual(2 * plotWidth);
      expect(runs).toHaveLength(1);
      expect(runs[0]![0]![0]).toBeCloseTo(plot.xForDistance(250));
    });

    it('keeps the extremes of every pixel column, so a surge stays on the plot', () => {
      const ys = runs.flat().map(([, y]) => y!);
      const surgeY = plot.zeroY - (55.5 / plot.extentSecs) * ((FRAME.height - 20) / 2);
      expect(Math.min(...ys)).toBeCloseTo(surgeY);
    });

    it('reads the scrub from the full-resolution curve', () => {
      for (const i of [30, 1_001, 2_002, 2_003, 4_000]) {
        expect(scrubDeltaSecs(long, i)).toBe(long.deltaSecs[i]);
      }
      expect(scrubDeltaSecs(long, 2_002)).toBe(55.5);
      expect(scrubDeltaSecs(long, 2_003)).toBe(Math.fround(values[2_003]!));
      expect(scrubDeltaSecs(long, POINTS)).toBeUndefined();
      expect(scrubDeltaSecs(undefined, 3)).toBeUndefined();
    });
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
