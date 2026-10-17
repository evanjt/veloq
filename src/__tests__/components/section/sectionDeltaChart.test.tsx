/**
 * Scenario: the delta plot draws the engine's per-lap delta curves against the
 * section's reference, and the plot switch offers it only where there are curves.
 * Expected behaviour: the selected attempt (else the newest) is drawn in full and
 * the rest faint, a NaN run is a gap, the whole-section figure needs an end delta,
 * and attempts without a curve are counted.
 */

import React from 'react';
import { View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Path } from '@shopify/react-native-skia';

import { SectionDeltaChart } from '@/features/routes/components/section/SectionDeltaChart';
import { SectionDeltaSummaryChart } from '@/features/routes/components/section/SectionDeltaSummaryChart';
import { PerformanceChartPanel } from '@/features/routes/components/section/PerformanceChartPanel';
import type { PerformanceDataPoint } from '@/types';
import { layoutViews } from '../../__shared__/layoutViews';
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

const full = (drawn: Record<string, unknown>[]) => drawn.filter((p) => p.opacity === undefined);

describe('SectionDeltaChart', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws the newest attempt in full and the others faint when none is selected', async () => {
    const drawn = capturePaths();
    await layoutViews(await render(chart()), 400, 300);

    const emphasised = full(drawn);
    expect(emphasised).toHaveLength(1);
    // The newest attempt is ahead of the reference throughout, so it runs below the zero line.
    const ys = String(emphasised[0]!.path)
      .match(/ (-?[\d.]+)/g)!
      .map((y) => Number(y));
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(drawn.length).toBe(LAPS.length);
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

  it('names the record as the reference, with its date', async () => {
    const record = await render(chart());
    expect(record.getByTestId('section-delta-caption').props.children).toContain(
      'sections.deltaVsRecord'
    );
    await record.unmount();

    const set = await render(
      chart({
        deltas: direction(LAPS, { referenceSource: 1 as FfiDirectionDeltas['referenceSource'] }),
      })
    );
    expect(set.getByTestId('section-delta-caption').props.children).toContain(
      'sections.deltaVsReference'
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
      forwardColour="#0D9488"
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
const SPLIT_LAPS = [
  lap('ref', 0, LEVEL),
  lap('older', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8], { splitDeltaSecs: Float32Array.from(OLDER_SPLITS) }),
  lap('newest', 2, [0, -1, -2, -3, -4, -5, -6, -7, -8], {
    splitDeltaSecs: Float32Array.from([-1, -2, -3, -2]),
  }),
];

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
    expect(Array.from(line!.splits)).toEqual(Array.from(TYPICAL.medianSecs));
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
    expect(Array.from(lastLine(onDeltaLineChange)!.splits)).toEqual(OLDER_SPLITS);
  });

  it('with no attempt chosen and no typical attempt, offers no delta and hands the map nothing', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(panel(curvesWith(undefined), { onDeltaLineChange }));

    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
    expect(onDeltaLineChange.mock.calls.every(([line]) => line === null)).toBe(true);
  });

  it('returns to the scatter when the attempt is cleared and no typical attempt exists', async () => {
    const onDeltaLineChange = jest.fn();
    const tree = await render(
      panel(curvesWith(undefined), { onDeltaLineChange, highlightedActivityId: 'older' })
    );
    await fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();

    await tree.rerender(panel(curvesWith(undefined), { onDeltaLineChange }));

    expect(tree.queryByTestId('section-delta-chart')).toBeNull();
    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
    expect(lastLine(onDeltaLineChange)).toBeNull();
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

  async function scrubAt(tree: Awaited<ReturnType<typeof render>>, metres: number) {
    const plot = tree
      .UNSAFE_getAllByType(View)
      .find((node) => node.props.onResponderGrant !== undefined)!;
    await fireEvent(plot, 'responderGrant', { nativeEvent: { locationX: xAtMetres(metres) } });
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
});
