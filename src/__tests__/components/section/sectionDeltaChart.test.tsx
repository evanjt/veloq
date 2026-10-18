/**
 * Scenario: the delta plot draws the engine's per-lap delta curves against the
 * section's reference, and the plot switch offers it only where there are curves.
 * Expected behaviour: the selected attempt (else the newest) is drawn in full and
 * the rest faint, a NaN run is a gap, the whole-section figure needs an end delta,
 * and attempts without a curve are counted.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Path } from '@shopify/react-native-skia';

import { SectionDeltaChart } from '@/features/routes/components/section/SectionDeltaChart';
import { SectionDeltaSummaryChart } from '@/features/routes/components/section/SectionDeltaSummaryChart';
import { PerformanceChartPanel } from '@/features/routes/components/section/PerformanceChartPanel';
import type { PerformanceDataPoint } from '@/types';
import { light as lightHaptic } from '@/shared/ui/haptics';
import { SelectButton } from '@/shared/ui';
import { layoutViews } from '../../__shared__/layoutViews';
import {
  capturePans,
  pressAndLift,
  release,
  scrub,
  scrubPan,
  touchAndMove,
  touchAt,
} from '../../__shared__/chartScrub';
import { SCRUB_SLOP } from '@/shared/charts/scrubPanDecision';
import { chartStroke } from '@/shared/charts';
import { colourTokens } from '@/theme';
import type {
  FfiDirectionDeltas,
  FfiLapDelta,
  FfiLapDeltaMissing,
  FfiSectionLapCurves,
  FfiSplitSummary,
} from 'veloqrs';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
jest.mock('@/shared/ui/haptics', () => ({
  ...jest.requireActual('@/shared/ui/haptics'),
  light: jest.fn(),
}));

const GRID_STEP_M = 50;
const SECTION_LENGTH_M = 400;
const DAY_SECS = 86_400;

function lap(id: string, day: number, deltaSecs: number[], extra: Partial<FfiLapDelta> = {}) {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: 1_780_000_000 + day * DAY_SECS,
    deltaSecs: Float32Array.from(deltaSecs),
    splitDeltaSecs: new Float32Array(0),
    endDeltaSecs: deltaSecs[deltaSecs.length - 1],
    ...extra,
  } as FfiLapDelta;
}

/** The direction's laps with the peak the engine computes over them. */
function direction(
  laps: FfiLapDelta[],
  extra: Partial<FfiDirectionDeltas> = {}
): FfiDirectionDeltas {
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
    ...extra,
  } as FfiDirectionDeltas;
}

function missing(id: string): FfiLapDeltaMissing {
  return { activityId: id, startIndex: 0, activityDate: 1_780_000_000, reason: 0 };
}

const LEVEL = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const LAPS = [
  lap('ref', 0, LEVEL),
  lap('older', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8]),
  lap('newest', 2, [0, -1, -2, -3, -4, -5, -6, -7, -8]),
];

function chart(props: Partial<React.ComponentProps<typeof SectionDeltaChart>> = {}) {
  return (
    <SectionDeltaChart
      deltas={direction(LAPS)}
      gridStepM={GRID_STEP_M}
      sectionLengthM={SECTION_LENGTH_M}
      isDark={false}
      {...props}
    />
  );
}

/** The Path props drawn on each render, so a test reads what was placed. */
function capturePaths() {
  const drawn: Record<string, unknown>[] = [];
  const path = Path as unknown as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const original = path.render;
  jest.spyOn(path, 'render').mockImplementation((props, ref) => {
    drawn.push(props);
    return original(props, ref);
  });
  return drawn;
}

const lines = (drawn: Record<string, unknown>[]) => drawn.filter((p) => p.style === 'stroke');
const full = (drawn: Record<string, unknown>[]) =>
  lines(drawn).filter((p) => p.strokeWidth === chartStroke.series);
const fills = (drawn: Record<string, unknown>[]) => drawn.filter((p) => p.style === 'fill');

describe('SectionDeltaChart', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws the newest attempt in full and the others faint when none is selected', async () => {
    const drawn = capturePaths();
    await layoutViews(await render(chart()), 400, 300);

    const emphasised = full(drawn);
    expect(emphasised).toHaveLength(1);
    // The newest attempt is ahead of the reference throughout, so it runs above the zero line.
    const ys = String(emphasised[0]!.path)
      .match(/ (-?[\d.]+)/g)!
      .map((y) => Number(y));
    // It starts level on the zero line and only ever rises from it.
    expect(Math.max(...ys)).toBeCloseTo(ys[0]!);
    expect(Math.min(...ys)).toBeLessThan(ys[0]!);
    expect(lines(drawn).length).toBe(LAPS.length);
    expect(emphasised[0]!.color).toBe(colourTokens.light['text-primary']);
    for (const muted of lines(drawn).filter((p) => p !== emphasised[0])) {
      expect(muted.color).toBe(colourTokens.light['chart-muted']);
    }
  });

  it('draws the selected attempt in full instead of the newest', async () => {
    const drawn = capturePaths();
    const withNewest = await render(chart());
    await layoutViews(withNewest, 400, 300);
    const newestPath = String(full(drawn)[0]!.path);
    await withNewest.unmount();
    drawn.length = 0;

    await layoutViews(await render(chart({ highlightedActivityId: 'older' })), 400, 300);

    expect(full(drawn)).toHaveLength(1);
    expect(String(full(drawn)[0]!.path)).not.toBe(newestPath);
  });

  it('leaves a gap at a NaN run and does not draw a zero there', async () => {
    const drawn = capturePaths();
    const partial = lap('partial', 3, [NaN, NaN, 0, 4, NaN, NaN, 5, 6, 7]);
    await layoutViews(await render(chart({ deltas: direction([partial]) })), 400, 300);

    const path = String(full(drawn)[0]!.path);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toMatch(/NaN/);
  });

  it('shows the whole-section figure only where the engine gave an end delta', async () => {
    const withEnd = await render(chart({ highlightedActivityId: 'older' }));
    expect(withEnd.getByTestId('section-delta-end').props.children).toContain('"time":"8 s"');
    await withEnd.unmount();

    const partial = lap('partial', 3, [NaN, 0, 2, 3]);
    delete (partial as { endDeltaSecs?: number }).endDeltaSecs;
    const withoutEnd = await render(chart({ deltas: direction([partial]) }));
    expect(withoutEnd.queryByTestId('section-delta-end')).toBeNull();
  });

  it('counts the attempts that have no curve', async () => {
    const tree = await render(
      chart({ deltas: direction(LAPS, { missing: [missing('x'), missing('y')] }) })
    );

    expect(tree.getByTestId('section-delta-missing').props.children).toContain('"attempts":2');
  });

  it('shows no missing count when every attempt is drawn', async () => {
    const tree = await render(chart());

    expect(tree.queryByTestId('section-delta-missing')).toBeNull();
  });

  it('fills an attempt behind the reference in another colour than one ahead of it', async () => {
    const drawn = capturePaths();
    const ahead = await render(chart({ highlightedActivityId: 'newest' }));
    await layoutViews(ahead, 400, 300);
    const aheadFills = fills(drawn).map((p) => p.color);
    await ahead.unmount();
    drawn.length = 0;

    await layoutViews(await render(chart({ highlightedActivityId: 'older' })), 400, 300);
    const behindFills = fills(drawn).map((p) => p.color);

    expect(aheadFills).toEqual([colourTokens.light['data-div-cool-3']]);
    expect(behindFills).toEqual([colourTokens.light['data-div-warm-3']]);
  });

  it('names the record on the flat line and in the legend, with its date', async () => {
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);

    expect(tree.getByTestId('section-delta-reference-name').props.children).toBe(
      'sections.deltaReferenceRecord'
    );
    const legend = String(tree.getByTestId('section-delta-caption').props.children);
    expect(legend).toContain('sections.deltaFlatLineDated');
    expect(legend).toContain('sections.deltaReferenceRecordPhrase');
  });

  it('names the previous record when this attempt is the record', async () => {
    const previous = lap('prev', -3, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const deltas = direction(LAPS, {
      referenceActivityId: 'ref',
      defaultReference: 2 as FfiDirectionDeltas['defaultReference'],
      previousRecord: previous,
    });
    const tree = await render(chart({ deltas, highlightedActivityId: 'ref' }));
    await layoutViews(tree, 400, 300);

    expect(tree.getByTestId('section-delta-reference-name').props.children).toBe(
      'sections.deltaReferencePreviousRecord'
    );
    expect(String(tree.getByTestId('section-delta-caption').props.children)).toContain(
      'sections.deltaReferencePreviousRecordPhrase'
    );
  });

  it('names a set reference when the reference is not the record', async () => {
    const tree = await render(
      chart({
        deltas: direction(LAPS, { referenceSource: 1 as FfiDirectionDeltas['referenceSource'] }),
      })
    );
    await layoutViews(tree, 400, 300);

    expect(tree.getByTestId('section-delta-reference-name').props.children).toBe(
      'sections.deltaReferenceAthleteSet'
    );
  });
});

const CHART_DATA = Array.from({ length: 4 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `act-${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + i * 0.1,
  sectionTime: 305 + i * 10,
  sectionDistance: 3000,
  direction: 'forward',
  x: i / 3,
})) as unknown as (PerformanceDataPoint & { x: number })[];

function panel(
  curves: FfiSectionLapCurves | undefined,
  extra: Partial<React.ComponentProps<typeof PerformanceChartPanel>> = {}
) {
  return (
    <PerformanceChartPanel
      chartData={CHART_DATA}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      curves={curves}
      {...extra}
    />
  );
}

const MEDIAN = [9.5, 11.2, 0.4, -2];
const TYPICAL: FfiSplitSummary = {
  medianSecs: Float32Array.from(MEDIAN),
  lowerQuartileSecs: Float32Array.from([NaN, NaN, NaN, NaN]),
  upperQuartileSecs: Float32Array.from([NaN, NaN, NaN, NaN]),
  laps: [6, 6, 5, 5],
};
const OLDER_SPLITS = [1, 2, 3, 2];
/** The reference takes 100 s over every split, so a second behind is a percent. */
const REFERENCE_SPLIT_SECS = 100;
const ownSplits = (deltas: number[]) =>
  Float32Array.from(deltas, (delta) => REFERENCE_SPLIT_SECS + delta);
const SPLIT_LAPS = [
  lap('ref', 0, LEVEL, {
    splitDeltaSecs: Float32Array.from([0, 0, 0, 0]),
    splitSecs: ownSplits([0, 0, 0, 0]),
  }),
  lap('older', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8], {
    splitDeltaSecs: Float32Array.from(OLDER_SPLITS),
    splitSecs: ownSplits(OLDER_SPLITS),
  }),
  lap('newest', 2, [0, -1, -2, -3, -4, -5, -6, -7, -8], {
    splitDeltaSecs: Float32Array.from([-1, -2, -3, -2]),
    splitSecs: ownSplits([-1, -2, -3, -2]),
  }),
];

/** The percentages the map was handed, each to four places. */
const percentsOf = (line: SectionDeltaLine | null) =>
  Array.from(line!.percents, (percent) => Number(percent.toFixed(4)));

function curvesWith(splitSummary: FfiSplitSummary | undefined): FfiSectionLapCurves {
  return {
    gridStepM: GRID_STEP_M,
    splitStepM: 100,
    sectionLengthM: SECTION_LENGTH_M,
    forward: direction(SPLIT_LAPS, splitSummary ? { splitSummary } : {}),
  };
}

/** The last line the panel reported to the map. */
function lastLine(onDeltaLineChange: jest.Mock): SectionDeltaLine | null {
  const calls = onDeltaLineChange.mock.calls;
  return calls[calls.length - 1]![0] as SectionDeltaLine | null;
}

describe('PerformanceChartPanel delta plot', () => {
  it('offers delta with an attempt chosen and draws its curve when chosen', async () => {
    const tree = await render(
      panel(
        {
          gridStepM: GRID_STEP_M,
          splitStepM: 100,
          sectionLengthM: SECTION_LENGTH_M,
          forward: direction(LAPS),
        },
        { highlightedActivityId: 'older' }
      )
    );

    await fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();
    expect(tree.getByTestId('chart-plot-delta').props.accessibilityState.selected).toBe(true);
  });

  it('with no attempt chosen, offers delta from the typical attempt and hands the map its medians', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(panel(curvesWith(TYPICAL), { onDeltaLineChange }));

    await fireEvent.press(tree.getByTestId('chart-plot-delta'));

    expect(tree.getByTestId('section-delta-summary-chart')).toBeTruthy();
    expect(tree.queryByTestId('section-delta-chart')).toBeNull();
    const line = lastLine(onDeltaLineChange);
    expect(percentsOf(line)).toEqual(MEDIAN);
    expect(line).toMatchObject({
      splitStepM: 100,
      sectionLengthM: SECTION_LENGTH_M,
      direction: 'forward',
    });
  });

  it('with an attempt chosen, draws that attempt and hands the map its own splits', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(
      panel(curvesWith(TYPICAL), { onDeltaLineChange, highlightedActivityId: 'older' })
    );

    await fireEvent.press(tree.getByTestId('chart-plot-delta'));

    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();
    expect(tree.queryByTestId('section-delta-summary-chart')).toBeNull();
    expect(percentsOf(lastLine(onDeltaLineChange))).toEqual(OLDER_SPLITS);
  });

  it('with no attempt chosen and no typical attempt, still offers delta and hands the map nothing until shown', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(panel(curvesWith(undefined), { onDeltaLineChange }));

    expect(tree.getByTestId('chart-plot-delta')).toBeTruthy();
    expect(onDeltaLineChange.mock.calls.every(([line]) => line === null)).toBe(true);
  });

  it('keeps drawing the curves when the attempt is cleared and no typical attempt exists', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(
      panel(curvesWith(undefined), { onDeltaLineChange, highlightedActivityId: 'older' })
    );
    await fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();

    await tree.rerender(panel(curvesWith(undefined), { onDeltaLineChange }));

    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();
    expect(tree.getByTestId('chart-plot-delta').props.accessibilityState.selected).toBe(true);
  });

  it('offers the references the engine gave and re-measures the attempt against the one chosen', async () => {
    const onDeltaLineChange = jest.fn();
    const previous = lap('prev', -3, LEVEL, {
      splitDeltaSecs: Float32Array.from([1, 1, 1, 1]),
      splitSecs: ownSplits([1, 1, 1, 1]),
    });
    const curves = curvesWith(TYPICAL);
    curves.forward = { ...curves.forward!, previousRecord: previous };
    const tree = await render(panel(curves, { onDeltaLineChange, highlightedActivityId: 'older' }));
    await fireEvent.press(tree.getByTestId('chart-plot-delta'));

    const compare = tree.UNSAFE_getByType(SelectButton);
    expect(compare.props.options.map((o: { value: string }) => o.value)).toEqual(['0', '2']);
    await act(async () => {
      compare.props.onChange('2');
    });

    expect(tree.getByTestId('section-delta-reference-name').props.children).toBe(
      'sections.deltaReferencePreviousRecord'
    );
    // Measured against the previous record, which takes 101 s over each split.
    expect(percentsOf(lastLine(onDeltaLineChange))).toEqual(
      [0, 1, 2, 1].map((behind) => Number(((behind / 101) * 100).toFixed(4)))
    );
  });

  it('offers no delta option when curves is absent', async () => {
    const tree = await render(panel(undefined));

    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
  });

  it('offers no delta option for a direction without curves', async () => {
    const tree = await render(
      panel({
        gridStepM: GRID_STEP_M,
        splitStepM: 100,
        sectionLengthM: SECTION_LENGTH_M,
        reverse: direction(LAPS),
      })
    );

    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
  });
});

describe('SectionDeltaSummaryChart', () => {
  // 400 px wide with 12 px left and 8 px right padding: 0.95 px a metre.
  const xAtMetres = (m: number) => 12 + m * 0.95;

  function summaryChart(
    props: Partial<React.ComponentProps<typeof SectionDeltaSummaryChart>> = {}
  ) {
    return (
      <SectionDeltaSummaryChart
        summary={TYPICAL}
        referenceSource={0 as FfiDirectionDeltas['referenceSource']}
        splitStepM={100}
        sectionLengthM={SECTION_LENGTH_M}
        isDark={false}
        {...props}
      />
    );
  }

  let pans: ReturnType<typeof capturePans>;
  beforeEach(() => {
    jest.clearAllMocks();
    pans = capturePans();
  });
  afterEach(() => jest.restoreAllMocks());

  async function scrubAt(_tree: Awaited<ReturnType<typeof render>>, metres: number) {
    await scrub(scrubPan(pans), xAtMetres(metres));
  }

  it('names the record and the split it is shown per, and the attempts behind it', async () => {
    const tree = await render(summaryChart());

    expect(tree.getByTestId('section-delta-summary-caption').props.children).toBe(
      'sections.deltaTypicalVsRecord:{"distance":"100 m"}'
    );
    expect(tree.getByTestId('section-delta-summary-attempts').props.children).toBe(
      'sections.deltaTypicalAttempts:{"count":6}'
    );
  });

  it('names a set reference when the reference is not the record', async () => {
    const tree = await render(
      summaryChart({ referenceSource: 1 as FfiDirectionDeltas['referenceSource'] })
    );

    expect(tree.getByTestId('section-delta-summary-caption').props.children).toContain(
      'sections.deltaTypicalVsReference'
    );
  });

  it('reads the split under the touch, its range and how far the typical attempt is behind', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);

    await scrubAt(tree, 150);

    expect(tree.getByTestId('section-delta-summary-scrub').props.children).toBe(
      'sections.deltaTypicalSlowerThanRecord:{"from":"100 m","to":"200 m","time":"11 s"}'
    );
  });

  it('reads a split the typical attempt wins as faster, the last split ending at the section end', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);

    await scrubAt(tree, 350);

    expect(tree.getByTestId('section-delta-summary-scrub').props.children).toBe(
      'sections.deltaTypicalFasterThanRecord:{"from":"300 m","to":"400 m","time":"2 s"}'
    );
  });

  it('reads nothing over a split with no typical figure', async () => {
    const gap: FfiSplitSummary = { ...TYPICAL, medianSecs: Float32Array.from([9.5, NaN, 0.4, -2]) };
    const tree = await render(summaryChart({ summary: gap }));
    await layoutViews(tree, 400, 300);

    await scrubAt(tree, 150);

    expect(tree.queryByTestId('section-delta-summary-scrub')).toBeNull();
  });

  it('shows no readout for a touch that goes down and lifts without moving', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);

    await pressAndLift(scrubPan(pans), xAtMetres(150), 50);

    expect(tree.queryByTestId('section-delta-summary-scrub')).toBeNull();
    expect(lightHaptic).not.toHaveBeenCalled();
  });

  it('shows the readout and ticks once when a horizontal move passes the slop', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);

    await scrub(scrubPan(pans), xAtMetres(150), [xAtMetres(160), xAtMetres(250)]);

    expect(tree.getByTestId('section-delta-summary-scrub').props.children).toContain(
      '"from":"200 m"'
    );
    expect(lightHaptic).toHaveBeenCalledTimes(1);
  });

  it('fails the scrub on a vertical move, leaving the touch to the page', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);

    const x = xAtMetres(150);
    const mgr = await touchAndMove(scrubPan(pans), touchAt(x), [touchAt(x, 0, SCRUB_SLOP + 4)]);

    expect(mgr.fail).toHaveBeenCalled();
    expect(mgr.activate).not.toHaveBeenCalled();
    expect(tree.queryByTestId('section-delta-summary-scrub')).toBeNull();
    expect(lightHaptic).not.toHaveBeenCalled();
  });

  it('clears the readout when the finger lifts', async () => {
    const tree = await render(summaryChart());
    await layoutViews(tree, 400, 300);
    const pan = scrubPan(pans);

    await scrub(pan, xAtMetres(150));
    await release(pan);

    expect(tree.queryByTestId('section-delta-summary-scrub')).toBeNull();
  });
});

describe('SectionDeltaChart scrub', () => {
  // 400 px wide with 12 px left and 8 px right padding: 0.95 px a metre.
  const xAtMetres = (m: number) => 12 + m * 0.95;

  let pans: ReturnType<typeof capturePans>;
  beforeEach(() => {
    jest.clearAllMocks();
    pans = capturePans();
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows no readout for a touch that goes down and lifts without moving', async () => {
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);

    await pressAndLift(scrubPan(pans), xAtMetres(200), 50);

    expect(tree.queryByTestId('section-delta-scrub')).toBeNull();
    expect(lightHaptic).not.toHaveBeenCalled();
  });

  it('reads the emphasised attempt at the nearest 100 m and ticks once on a horizontal scrub', async () => {
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);

    await scrub(scrubPan(pans), xAtMetres(130), [xAtMetres(160)]);

    // The newest attempt is 4 s ahead at 200 m, grid index 4.
    expect(tree.getByTestId('section-delta-scrub').props.children).toBe(
      'sections.deltaReadoutAhead:{"distance":"200 m","time":"4 s"}'
    );
    expect(lightHaptic).toHaveBeenCalledTimes(1);
  });

  it('holds the readout to the section past its far end', async () => {
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);

    await scrub(scrubPan(pans), 399);

    expect(tree.getByTestId('section-delta-scrub').props.children).toBe(
      'sections.deltaReadoutAhead:{"distance":"400 m","time":"8 s"}'
    );
  });

  it('fails the scrub on a vertical move', async () => {
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);

    const x = xAtMetres(200);
    const mgr = await touchAndMove(scrubPan(pans), touchAt(x), [touchAt(x, 0, SCRUB_SLOP + 4)]);

    expect(mgr.fail).toHaveBeenCalled();
    expect(tree.queryByTestId('section-delta-scrub')).toBeNull();
  });
});
