/**
 * Scenario: under a right-to-left layout a ride's power chart labelled 44.8 km
 * at its left edge and 0 at its right, while the canvas still drew the ride
 * from its start on the left. A canvas draws in physical pixels and never
 * mirrors; the axis labels, gutters and crosshair around it are views, and
 * views mirror, so the axis ran the other way from the marks it labelled.
 *
 * Expected behaviour: every chart's canvas and the labels placed against it
 * sit in a box laid out left to right, so the axis and the marks read the same
 * way in any layout direction.
 */

import React from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactTestInstance } from 'react-test-renderer';
import { Canvas } from '@shopify/react-native-skia';

import { ChartSurface } from '@/shared/charts/ChartSurface';
import { getEngine } from '@/shared/native/engine';
import {
  ActivityHeatmap,
  type ActivityHeatmapHandle,
} from '@/features/stats/components/ActivityHeatmap';
import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import { SummaryCardHRVSparkline } from '@/features/home/components/SummaryCardHRVSparkline';
import { InsightRowTrend } from '@/features/insights/components/InsightRowTrend';
import { PeriodComparisonContent } from '@/features/insights/components/content/PeriodComparisonContent';
import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { SectionDeltaChart } from '@/features/routes/components/section/SectionDeltaChart';
import { SectionDeltaSummaryChart } from '@/features/routes/components/section/SectionDeltaSummaryChart';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import type { Insight, InsightHistory } from '@/features/insights/types';
import type { PerformanceDataPoint } from '@/types';
import type {
  FfiAttemptHistogram,
  FfiDirectionDeltas,
  FfiLapDelta,
  FfiSplitSummary,
} from 'veloqrs';
import { RangeCoverage } from 'veloqrs';
import { layoutViews } from '../__shared__/layoutViews';
import { localDay } from '../__shared__/clockEdges';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

type Tree = Awaited<ReturnType<typeof render>>;

/** The node or one of its ancestors lays its children out left to right. */
function laidOutLeftToRight(node: ReactTestInstance): boolean {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (StyleSheet.flatten(at.props.style)?.direction === 'ltr') return true;
  }
  return false;
}

function canvases(tree: Tree): ReactTestInstance[] {
  return tree.UNSAFE_getAllByType(Canvas as unknown as React.ComponentType);
}

/** Every canvas in the chart, and every label named, sits in a left to right box. */
function expectPinned(tree: Tree, labels: ReactTestInstance[]) {
  const drawn = canvases(tree);
  expect(drawn.length).toBeGreaterThan(0);
  expect(labels.length).toBeGreaterThan(0);
  for (const node of [...drawn, ...labels]) expect(laidOutLeftToRight(node)).toBe(true);
}

const wasRtl = I18nManager.isRTL;
beforeAll(() => {
  I18nManager.isRTL = true;
});
afterAll(() => {
  I18nManager.isRTL = wasRtl;
});
afterEach(() => jest.restoreAllMocks());

const SERIES = [40, 41, 43, 42, 44, 45, 46];
const DAY = 86_400;

function lap(id: string, day: number, deltaSecs: number[]): FfiLapDelta {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: 1_780_000_000 + day * DAY,
    deltaSecs: Float32Array.from(deltaSecs),
    splitDeltaSecs: new Float32Array(0),
    endDeltaSecs: deltaSecs[deltaSecs.length - 1],
  } as FfiLapDelta;
}

const DELTAS = {
  referenceActivityId: 'ref',
  referenceSource: 0,
  defaultReference: 0,
  laps: [lap('ref', 0, [0, 0, 0, 0, 0]), lap('newest', 1, [0, -1, -2, -3, -4])],
  missing: [],
  peakDeltaSecs: 4,
} as FfiDirectionDeltas;

const SPLITS: FfiSplitSummary = {
  medianSecs: Float32Array.from([9.5, 11.2, 0.4, -2]),
  lowerQuartileSecs: Float32Array.from([NaN, NaN, NaN, NaN]),
  upperQuartileSecs: Float32Array.from([NaN, NaN, NaN, NaN]),
  laps: [6, 6, 5, 5],
};

const HISTOGRAM: FfiAttemptHistogram = {
  startSecs: 300,
  binWidthSecs: 30,
  counts: [3, 2, 4],
  binned: 9,
  unbinnedOutsideBand: 0,
};

const SCATTER_DATA = Array.from({ length: 8 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `act-${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + (i % 4) * 0.25,
  sectionTime: 600 - i * 5,
  sectionDistance: 3000,
  direction: 'forward',
  x: i / 7,
})) as unknown as (PerformanceDataPoint & { x: number })[];

const HISTORY: Extract<InsightHistory, { series: unknown }> = {
  kind: 'sparkline',
  series: [
    {
      label: 'Load',
      points: SERIES.map((value, i) => ({ value, date: 1_780_000_000 + i * DAY })),
    },
  ],
  target: '/fitness',
};

const COMPARISON: Insight = {
  id: 'week-load',
  category: 'period_comparison',
  priority: 2,
  title: 'Load',
  icon: 'trending-up',
  iconTone: 'neutral',
  timestamp: 0,
  isNew: false,
  supportingData: {
    comparisonData: {
      current: { label: 'This week', value: 420, unit: 'TSS' },
      previous: { label: 'Last week', value: 360, unit: 'TSS' },
      change: { label: 'Change', value: '+17%' },
    },
  },
} as unknown as Insight;

async function mounted(chart: React.ReactElement): Promise<Tree> {
  const tree = await render(<View style={{ width: 400 }}>{chart}</View>);
  await layoutViews(tree, 400, 300);
  return tree;
}

describe('under a right-to-left layout', () => {
  it('lays out the plot every shared chart sits in left to right', async () => {
    const tree = await render(
      <ChartSurface summary="Power over the ride" table={null}>
        <View testID="plot-body">
          <Text>0 km</Text>
          <Text>44.8 km</Text>
        </View>
      </ChartSurface>
    );

    expect(laidOutLeftToRight(tree.getByTestId('plot-body'))).toBe(true);
    expect(laidOutLeftToRight(tree.getByText('44.8 km'))).toBe(true);
  });

  it("keeps the fitness sparkline's day count at the end its newest day is drawn", async () => {
    const tree = await mounted(
      <SummaryCardSparkline
        fitnessData={SERIES}
        fatigueData={SERIES.map((v) => v + 5)}
        formData={SERIES.map((v) => -v / 4)}
        width={300}
        showLabels
      />
    );

    expectPinned(tree, [
      tree.getByText(`units.daysShort:${JSON.stringify({ days: SERIES.length })}`),
      tree.getByText('metrics.fitness'),
    ]);
  });

  it("keeps the HRV sparkline's labels beside the plot they name", async () => {
    const tree = await mounted(
      <SummaryCardHRVSparkline hrvData={SERIES} rhrData={SERIES.map((v) => v + 10)} width={300} />
    );

    expectPinned(tree, tree.UNSAFE_getAllByType(Text));
  });

  it("draws an insight row's trend oldest to newest from the left", async () => {
    const tree = await mounted(
      <InsightRowTrend history={HISTORY} color="#0D9488" isDark={false} />
    );

    expectPinned(tree, [tree.getByTestId('insight-row-trend')]);
  });

  it('keeps each period bar label over its own bar', async () => {
    const tree = await mounted(<PeriodComparisonContent insight={COMPARISON} />);

    expectPinned(tree, [tree.getByText(/This week/), tree.getByText(/Last week/)]);
  });

  it("keeps the attempt histogram's time axis under the bars it counts", async () => {
    const tree = await mounted(
      <AttemptHistogramChart histogram={HISTOGRAM} activityType="Ride" isDark={false} />
    );

    expectPinned(tree, [
      tree.getByTestId('attempt-histogram-x-axis'),
      tree.getByTestId('attempt-histogram-y-axis'),
    ]);
  });

  it("keeps the section delta's distance axis under its curves", async () => {
    const tree = await mounted(
      <SectionDeltaChart deltas={DELTAS} gridStepM={50} sectionLengthM={200} isDark={false} />
    );

    expectPinned(tree, [
      tree.getByTestId('section-delta-x-axis'),
      tree.getByTestId('section-delta-y-axis'),
    ]);
  });

  it("keeps the split summary's distance axis under its bars", async () => {
    const tree = await mounted(
      <SectionDeltaSummaryChart
        summary={SPLITS}
        referenceSource={0 as FfiDirectionDeltas['referenceSource']}
        splitStepM={100}
        sectionLengthM={400}
        isDark={false}
      />
    );

    expectPinned(tree, [
      tree.getByTestId('section-delta-summary-x-axis'),
      tree.getByTestId('section-delta-summary-y-axis'),
    ]);
  });

  it("keeps the section scatter's time axis under its attempts", async () => {
    const tree = await mounted(
      <SectionScatterChart
        chartData={SCATTER_DATA}
        activityType="Ride"
        isDark={false}
        bestForwardRecord={null}
        bestReverseRecord={null}
        bestForwardIsRecord={false}
        bestReverseIsRecord={false}
        forwardStats={null}
        reverseStats={null}
        trendCurves={{}}
      />
    );

    expectPinned(tree, [tree.getByTestId('section-scatter-y-axis')]);
  });

  it("keeps the activity calendar's month labels and highlight over the days they mark", async () => {
    const today = localDay(new Date());
    const engine = {
      subscribe: () => () => {},
      getFitnessScreenData: fitnessScreenRead({
        heatmap: () => [{ date: today, intensity: 2, maxDuration: 3600, activityCount: 1 }],
      }),
      rangeCoverage: () => RangeCoverage.Loaded,
    };
    jest.mocked(getEngine).mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const handle = React.createRef<ActivityHeatmapHandle>();
    let tree: Tree | undefined;

    try {
      tree = await mounted(
        <QueryClientProvider client={client}>
          <WithScreenRead>
            {(training) => <ActivityHeatmap training={training} ref={handle} />}
          </WithScreenRead>
        </QueryClientProvider>
      );
      const view = tree;
      await waitFor(() => expect(view.getByTestId('activity-heatmap-months')).toBeTruthy());
      await act(async () => handle.current?.setHighlight(today));

      expectPinned(view, [
        view.getByTestId('activity-heatmap-months'),
        view.getByTestId('activity-heatmap-highlight'),
        view.getByTestId(`activity-heatmap-day-${today}`, { includeHiddenElements: true }),
      ]);
    } finally {
      tree?.unmount();
      jest.mocked(getEngine).mockReturnValue(null);
      client.clear();
    }
  });
});
