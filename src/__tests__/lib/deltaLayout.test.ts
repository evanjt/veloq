/**
 * Scenario: the delta plot places the engine's per-lap delta curves on an axis
 * of distance along the section, with the reference as the zero line.
 * Expected behaviour: a lap's path starts at its covered distance, a NaN run is
 * a gap, the newest lap is emphasised unless one is selected, and the scrub
 * stops every 100 m.
 */

import {
  layoutDelta,
  layoutSplitSummary,
  pickEmphasisedLap,
  rebaseCurve,
  scrubDeltaSecs,
  scrubStops,
} from '@/features/routes/lib/deltaLayout';
import type { FfiDirectionDeltas, FfiLapDelta, FfiSplitSummary } from 'veloqrs';

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
    defaultReference: 0,
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

describe('scrubStops', () => {
  it('stops every 100 m with the grid index of the curve point there', () => {
    expect(scrubStops(400, 50)).toEqual([
      { distanceM: 0, index: 0 },
      { distanceM: 100, index: 2 },
      { distanceM: 200, index: 4 },
      { distanceM: 300, index: 6 },
      { distanceM: 400, index: 8 },
    ]);
  });

  it('places no stop past the end of a section that is not a whole number of stops', () => {
    expect(scrubStops(450, 50).map((stop) => stop.distanceM)).toEqual([0, 100, 200, 300, 400]);
  });

  it('keeps the start for a section shorter than one stop, and gives none for a broken length', () => {
    expect(scrubStops(60, 50)).toEqual([{ distanceM: 0, index: 0 }]);
    expect(scrubStops(NaN, 50)).toEqual([]);
  });
});

function summary(
  median: number[],
  lower: number[] = median.map(() => NaN),
  upper: number[] = median.map(() => NaN)
): FfiSplitSummary {
  return {
    medianSecs: Float32Array.from(median),
    lowerQuartileSecs: Float32Array.from(lower),
    upperQuartileSecs: Float32Array.from(upper),
    laps: median.map(() => 6),
  } as FfiSplitSummary;
}

describe('layoutSplitSummary', () => {
  // A 350 m section in 100 m splits: four splits, the last one 50 m long.
  const LENGTH_M = 350;
  const STEP_M = 100;
  const plotLeft = FRAME.padding.left;
  const plotWidth = FRAME.width - FRAME.padding.left - FRAME.padding.right;
  const xAt = (m: number) => plotLeft + (m / LENGTH_M) * plotWidth;

  it('draws time lost above the zero line and time won below it, scaled to the largest median', () => {
    const plot = layoutSplitSummary(summary([4, -2, NaN, 1]), STEP_M, LENGTH_M, FRAME);

    expect(plot.extentSecs).toBe(4);
    expect(plot.zeroY).toBe(60);
    const [lost, won] = plot.bars;
    expect(lost).toMatchObject({ index: 0, lost: true, top: 10, bottom: 60 });
    expect(won).toMatchObject({ index: 1, lost: false, top: 60, bottom: 85 });
  });

  it('draws nothing for a split whose median is NaN', () => {
    const plot = layoutSplitSummary(summary([4, -2, NaN, 1]), STEP_M, LENGTH_M, FRAME);

    expect(plot.bars.map((bar) => bar.index)).toEqual([0, 1, 3]);
  });

  it('keeps each bar inside its own split, narrower than the split', () => {
    const plot = layoutSplitSummary(summary([4, -2, NaN, 1]), STEP_M, LENGTH_M, FRAME);

    const last = plot.bars[2]!;
    expect(last.left).toBeGreaterThan(xAt(300));
    expect(last.right).toBeLessThan(xAt(350));
    expect((last.left + last.right) / 2).toBeCloseTo((xAt(300) + xAt(350)) / 2);
    const first = plot.bars[0]!;
    expect(first.right - first.left).toBeLessThan(xAt(100) - xAt(0));
  });

  it('draws the quartiles as a whisker where both are finite, and none where either is NaN', () => {
    const plot = layoutSplitSummary(
      summary([4, -2, NaN, 1], [2, -3, NaN, 0], [6, -1, NaN, NaN]),
      STEP_M,
      LENGTH_M,
      FRAME
    );

    // The upper quartile of 6 s widens the axis past the largest median.
    expect(plot.extentSecs).toBe(6);
    const [lost, won] = plot.bars;
    expect(lost!.whisker!.top).toBeCloseTo(10);
    expect(lost!.whisker!.bottom).toBeCloseTo(60 - (2 / 6) * 50);
    expect(won!.whisker!.top).toBeCloseTo(60 + (1 / 6) * 50);
    expect(won!.whisker!.bottom).toBeCloseTo(60 + (3 / 6) * 50);
    expect(plot.bars[2]!.whisker).toBeNull();
  });

  it('draws no whisker at all when every quartile is NaN', () => {
    const plot = layoutSplitSummary(summary([4, -2, 1]), STEP_M, 300, FRAME);

    expect(plot.bars.every((bar) => bar.whisker === null)).toBe(true);
  });

  it('centres the scrub on every split, the short last one and a NaN one included', () => {
    const plot = layoutSplitSummary(summary([4, -2, NaN, 1]), STEP_M, LENGTH_M, FRAME);

    expect(plot.splitCentres).toHaveLength(4);
    expect(plot.splitCentres[0]).toBeCloseTo(xAt(50));
    expect(plot.splitCentres[2]).toBeCloseTo(xAt(250));
    expect(plot.splitCentres[3]).toBeCloseTo(xAt(325));
  });

  it('gives no scrub centres without a split step', () => {
    expect(layoutSplitSummary(summary([4, -2]), 0, LENGTH_M, FRAME).splitCentres).toEqual([]);
  });

  it('keeps a level summary from collapsing the axis', () => {
    const plot = layoutSplitSummary(summary([0, 0]), STEP_M, 200, FRAME);

    expect(plot.extentSecs).toBe(1);
    expect(plot.bars.every((bar) => bar.top === bar.bottom)).toBe(true);
  });
});

describe('rebaseCurve', () => {
  const previousRecord = Float32Array.from([0, 2, 5, 10]);

  it('measures a lap against another reference as the difference of the two curves', () => {
    const rebased = rebaseCurve(Float32Array.from([0, 1, 1, 4]), previousRecord);
    expect(Array.from(rebased)).toEqual([0, -1, -4, -6]);
  });

  it('puts the new reference level with itself everywhere', () => {
    expect(Array.from(rebaseCurve(previousRecord, previousRecord))).toEqual([0, 0, 0, 0]);
  });

  it('keeps a point either curve does not reach as a gap', () => {
    const rebased = rebaseCurve(Float32Array.from([NaN, 3, 4, 6]), Float32Array.from([0, 2, NaN]));
    expect(Number.isNaN(rebased[0])).toBe(true);
    expect(rebased[1]).toBe(1);
    expect(Number.isNaN(rebased[2])).toBe(true);
    expect(Number.isNaN(rebased[3])).toBe(true);
    expect(rebased).toHaveLength(4);
  });
});
