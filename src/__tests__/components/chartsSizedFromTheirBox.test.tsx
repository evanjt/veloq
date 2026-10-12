/**
 * Scenario: a tablet window is 1024 wide and the sheet or column a chart sits
 * in is 540. Charts that took their width from the window drew past the edge
 * of that box, cutting off the last bar and its label.
 *
 * Expected behaviour: each chart measures the box it is given and draws
 * nothing wider than it, draws nothing before it has been measured, and
 * redraws at the new width when the box changes.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { Canvas, Rect, RoundedRect, Skia } from '@shopify/react-native-skia';

import { PeriodComparisonContent } from '@/features/insights/components/content/PeriodComparisonContent';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import { SectionDeltaChart } from '@/features/routes/components/section/SectionDeltaChart';
import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { SectionPerformanceSlide } from '@/features/settings/components/whatsNew/SectionPerformanceSlide';
import { SummaryCard } from '@/features/home/components/SummaryCard';
import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import type { Insight } from '@/features/insights/types';
import type { PerformanceDataPoint } from '@/types';
import type { FfiAttemptHistogram, FfiDirectionDeltas, FfiLapDelta } from 'veloqrs';
import { spacing } from '@/theme';
import { stubIdleScheduler } from '../__shared__/idleScheduler';
import { layoutViews } from '../__shared__/layoutViews';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 1024, height: 1366, scale: 2, fontScale: 1 }),
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: undefined }) }));
jest.mock('@/shared/app/useSportSettings', () => ({
  useSportSettings: () => ({ data: undefined }),
  getSettingsForSport: () => undefined,
}));
jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));

const BOX = 540;
const HEIGHT = 300;

type Tree = Awaited<ReturnType<typeof render>>;

/** The widest fixed width any view in the tree is drawn at. */
function widestBox(tree: Tree): number {
  return Math.max(
    0,
    ...tree.UNSAFE_getAllByType(View).map((node) => {
      const width = StyleSheet.flatten(node.props.style)?.width;
      return typeof width === 'number' ? width : 0;
    })
  );
}

/** The rightmost edge of the rectangles of a type drawn in the tree. */
function rightEdge(tree: Tree, type: unknown): number {
  return Math.max(
    0,
    ...tree
      .UNSAFE_getAllByType(type as React.ComponentType)
      .map((node) => Number(node.props.x) + Number(node.props.width))
  );
}

function canvasWidths(tree: Tree): number[] {
  return tree.UNSAFE_getAllByType(Canvas as unknown as React.ComponentType).map((node) => {
    const width = StyleSheet.flatten(node.props.style)?.width;
    return typeof width === 'number' ? width : 0;
  });
}

function inBox(child: React.ReactElement) {
  return <View style={{ width: BOX }}>{child}</View>;
}

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

const TREND = Array.from({ length: 10 }, (_, i) => ({
  time: new Date(2026, 5, 1).getTime() / 1000 + i * 86_400 * 0.7,
  value: 5.4 + i * 0.01,
  upper: 5.8 + i * 0.01,
  lower: 5 + i * 0.01,
}));

function scatter() {
  return (
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
      trendCurves={{ forwardSpeed: TREND }}
    />
  );
}

function lap(id: string, day: number, deltaSecs: number[]): FfiLapDelta {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: 1_780_000_000 + day * 86_400,
    deltaSecs: Float32Array.from(deltaSecs),
    splitDeltaSecs: new Float32Array(0),
    endDeltaSecs: deltaSecs[deltaSecs.length - 1],
  } as FfiLapDelta;
}

const DELTAS = {
  referenceActivityId: 'ref',
  referenceSource: 0,
  laps: [lap('ref', 0, [0, 0, 0, 0, 0]), lap('newest', 1, [0, -1, -2, -3, -4])],
  missing: [],
  peakDeltaSecs: 4,
} as FfiDirectionDeltas;

const HISTOGRAM: FfiAttemptHistogram = {
  startSecs: 300,
  binWidthSecs: 30,
  counts: [3, 2, 4],
  binned: 9,
  unbinnedOutsideBand: 0,
};

/** The x of every point in the trend paths the scatter hands to Skia. */
function captureTrendXs(): number[] {
  const xs: number[] = [];
  jest.spyOn(Skia.Path, 'MakeFromSVGString').mockImplementation((svg: string) => {
    for (const [, x] of svg.matchAll(/[ML]\s*(-?[\d.]+)[ ,]/g)) xs.push(Number(x));
    return null;
  });
  return xs;
}

describe('charts sized from their box, not the window', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('the period comparison in the insight sheet', () => {
    it('draws nothing before its box is measured', async () => {
      const tree = await render(inBox(<PeriodComparisonContent insight={COMPARISON} />));

      expect(
        tree.UNSAFE_queryAllByType(RoundedRect as unknown as React.ComponentType)
      ).toHaveLength(0);
    });

    it('draws its canvas and bars inside a box narrower than the window', async () => {
      const tree = await render(inBox(<PeriodComparisonContent insight={COMPARISON} />));
      await layoutViews(tree, BOX, HEIGHT);

      expect(canvasWidths(tree)).toHaveLength(1);
      expect(canvasWidths(tree)[0]).toBeLessThanOrEqual(BOX);
      expect(rightEdge(tree, RoundedRect)).toBeLessThanOrEqual(BOX);
      expect(widestBox(tree)).toBeLessThanOrEqual(BOX);
    });

    it('redraws at the new width when its box changes', async () => {
      const tree = await render(inBox(<PeriodComparisonContent insight={COMPARISON} />));
      await layoutViews(tree, BOX, HEIGHT);
      const narrow = canvasWidths(tree)[0]!;

      const wider = 700;
      await layoutViews(tree, wider, HEIGHT);

      expect(canvasWidths(tree)[0]).toBeGreaterThan(narrow);
      expect(canvasWidths(tree)[0]).toBeLessThanOrEqual(wider);
    });
  });

  it('keeps the section scatter and its trend inside its box', async () => {
    const xs = captureTrendXs();
    const tree = await render(inBox(scatter()));
    await layoutViews(tree, BOX, HEIGHT);

    expect(widestBox(tree)).toBeLessThanOrEqual(BOX);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(BOX);
  });

  it('keeps the section delta plot inside its box', async () => {
    const tree = await render(
      inBox(
        <SectionDeltaChart deltas={DELTAS} gridStepM={50} sectionLengthM={200} isDark={false} />
      )
    );
    await layoutViews(tree, BOX, HEIGHT);

    expect(tree.UNSAFE_getAllByType(Rect as unknown as React.ComponentType).length).toBeGreaterThan(
      0
    );
    expect(widestBox(tree)).toBeLessThanOrEqual(BOX);
    expect(rightEdge(tree, Rect)).toBeLessThanOrEqual(BOX);
  });

  it('keeps the attempt histogram inside its box', async () => {
    const tree = await render(
      inBox(<AttemptHistogramChart histogram={HISTOGRAM} activityType="Ride" isDark={false} />)
    );
    await layoutViews(tree, BOX, HEIGHT);

    expect(tree.UNSAFE_getAllByType(Rect as unknown as React.ComponentType).length).toBeGreaterThan(
      0
    );
    expect(widestBox(tree)).toBeLessThanOrEqual(BOX);
    expect(rightEdge(tree, Rect)).toBeLessThanOrEqual(BOX);
  });

  it('fits two tour panels to a row of its box', async () => {
    const tree = await render(inBox(<SectionPerformanceSlide />));
    await layoutViews(tree, BOX, HEIGHT);

    const widths = canvasWidths(tree);
    expect(widths).toHaveLength(4);
    expect(widths[0]! + widths[1]! + spacing.sm).toBeLessThanOrEqual(BOX);
  });

  it("sizes the summary card's sparkline from the card", async () => {
    const idle = stubIdleScheduler('immediate');
    const tree = await render(
      inBox(
        <SummaryCard
          onProfilePress={() => {}}
          heroValue={40}
          heroLabel="metrics.fitness"
          heroColor="#000"
          fitnessData={[38, 39, 40, 41]}
          fatigueData={[40, 41, 42, 43]}
          formData={[-2, -2, -2, -2]}
          showSparkline
          supportingMetrics={[]}
        />
      )
    );
    await layoutViews(tree, BOX, HEIGHT);
    idle.restore();

    const sparkline = tree.getByTestId('summary-card-sparkline').props
      .children as React.ReactElement<React.ComponentProps<typeof SummaryCardSparkline>>;
    expect(sparkline.type).toBe(SummaryCardSparkline);
    expect(sparkline.props.width).toBeGreaterThan(0);
    expect(sparkline.props.width).toBeLessThanOrEqual(BOX);
  });
});
