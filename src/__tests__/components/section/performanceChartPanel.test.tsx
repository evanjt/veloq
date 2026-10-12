/**
 * Scenario: the section and route charts switch between the attempt scatter and
 * the histogram of the engine's bins, both drawing the same direction.
 * Expected behaviour: the scatter opens first, the histogram draws the bins of
 * the direction on show, and a plot whose data is gone is not offered.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { DashPathEffect, Line, Rect } from '@shopify/react-native-skia';

import { PerformanceChartPanel } from '@/features/routes/components/section/PerformanceChartPanel';
import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { SectionPerformanceSection } from '@/features/routes/components/section/SectionPerformanceSection';
import type { PerformanceDataPoint } from '@/types';
import type { FfiAttemptHistogram, FfiAttemptHistograms } from 'veloqrs';
import { colors } from '@/theme';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

const CHART_DATA = Array.from({ length: 6 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `act-${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + i * 0.1,
  sectionTime: 305 + i * 10,
  sectionDistance: 3000,
  direction: i % 2 === 0 ? 'forward' : 'reverse',
  x: i / 5,
})) as unknown as (PerformanceDataPoint & { x: number })[];

function bins(
  counts: number[],
  startSecs: number,
  binWidthSecs: number,
  extra: Partial<FfiAttemptHistogram> = {}
): FfiAttemptHistogram {
  return {
    startSecs,
    binWidthSecs,
    counts,
    binned: counts.reduce((a, b) => a + b, 0),
    unbinnedOutsideBand: 0,
    ...extra,
  };
}

const FORWARD = bins([3, 2], 300, 30);
const REVERSE = bins([1, 4], 600, 60);
const HISTOGRAMS: FfiAttemptHistograms = {
  forward: FORWARD,
  reverse: REVERSE,
};

function panel(props: Partial<React.ComponentProps<typeof PerformanceChartPanel>> = {}) {
  return (
    <PerformanceChartPanel
      chartData={CHART_DATA}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={{ bestTime: 310, activityDate: new Date(2026, 5, 1) }}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      histograms={HISTOGRAMS}
      {...props}
    />
  );
}

/** The Rect props drawn on each render, so a test reads what was placed. */
function captureRects() {
  const drawn: Record<string, unknown>[] = [];
  const rect = Rect as unknown as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const original = rect.render;
  jest.spyOn(rect, 'render').mockImplementation((props, ref) => {
    drawn.push(props);
    return original(props, ref);
  });
  return drawn;
}

/** The Line props drawn on each render, so a test reads each mark's stroke. */
function captureLines() {
  const drawn: Record<string, unknown>[] = [];
  const line = Line as unknown as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const original = line.render;
  jest.spyOn(line, 'render').mockImplementation((props, ref) => {
    drawn.push(props);
    return original(props, ref);
  });
  return drawn;
}

/** The x a vertical mark is drawn at. */
const markX = (mark: Record<string, unknown>) => (mark.p1 as { x: number }).x;

const isDashed = (mark: Record<string, unknown>) =>
  React.Children.toArray(mark.children as React.ReactNode).some(
    (child) => React.isValidElement(child) && child.type === DashPathEffect
  );

const barsOf = (drawn: Record<string, unknown>[]) =>
  drawn.filter((r) => r.color === colors.primary);

describe('PerformanceChartPanel', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the trend key only for the direction with a drawn curve', async () => {
    const trend = [
      { time: 1, value: 5, upper: 5.2, lower: 4.8 },
      { time: 2, value: 5.1, upper: 5.3, lower: 4.9 },
    ];
    const tree = await render(panel({ trendCurves: { forwardSpeed: trend } }));

    expect(tree.getByText('sections.legendTrend')).toBeTruthy();
    expect(tree.getByText('sections.legendTrendBand')).toBeTruthy();

    await fireEvent.press(tree.getByTestId('section-chart-direction-reverse'));
    expect(tree.queryByText('sections.legendTrend')).toBeNull();
    expect(tree.queryByText('sections.legendTrendBand')).toBeNull();
  });

  it('opens on the scatter and switches to the histogram and back', async () => {
    const tree = await render(panel());

    expect(tree.queryByTestId('attempt-histogram')).toBeNull();
    expect(tree.getByTestId('chart-plot-scatter').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    expect(tree.getByTestId('attempt-histogram')).toBeTruthy();
    expect(tree.getByTestId('chart-plot-histogram').props.accessibilityState.selected).toBe(true);

    await fireEvent.press(tree.getByTestId('chart-plot-scatter'));
    expect(tree.queryByTestId('attempt-histogram')).toBeNull();
  });

  it('draws the plot and direction switches as chips, not bordered buttons', async () => {
    const tree = await render(panel());

    for (const id of ['chart-plot-scatter', 'section-chart-direction-reverse']) {
      expect(StyleSheet.flatten(tree.getByTestId(id).props.style).borderWidth).toBeUndefined();
    }
  });

  it('draws the reverse bins after reverse is chosen, not the forward ones', async () => {
    const drawn = captureRects();
    const tree = await render(panel());

    await fireEvent.press(tree.getByTestId('section-chart-direction-reverse'));
    drawn.length = 0;
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    await layoutViews(tree, 400, 300);

    const bars = barsOf(drawn).slice(-2);
    expect(bars).toHaveLength(2);
    expect(Number(bars[1].height) / Number(bars[0].height)).toBeCloseTo(4);
    expect(tree.getByTestId('attempt-histogram-caption').props.children).toContain('"attempts":5');
  });

  it("labels the histogram's line Best while the direction holds no record", async () => {
    const tree = await render(panel({ bestForwardIsRecord: false }));
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));

    expect(tree.getByTestId('attempt-histogram-record-key')).toHaveTextContent('sections.best');
  });

  it("labels the histogram's line PR once the direction holds a record", async () => {
    const tree = await render(panel({ bestForwardIsRecord: true }));
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));

    expect(tree.getByTestId('attempt-histogram-record-key')).toHaveTextContent('sections.legendPr');
  });

  it('keeps the chosen direction when the plot changes', async () => {
    const tree = await render(panel());

    await fireEvent.press(tree.getByTestId('section-chart-direction-reverse'));
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));

    expect(
      tree.getByTestId('section-chart-direction-reverse').props.accessibilityState.selected
    ).toBe(true);
  });

  it('offers no histogram segment when the direction has no bins', async () => {
    const tree = await render(panel({ histograms: { reverse: REVERSE } }));

    expect(tree.queryByTestId('chart-plot-histogram')).toBeNull();
    await fireEvent.press(tree.getByTestId('section-chart-direction-reverse'));
    expect(tree.getByTestId('chart-plot-histogram')).toBeTruthy();
  });

  it('falls back to the scatter when the shown histogram loses its data', async () => {
    const tree = await render(panel());
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    expect(tree.getByTestId('attempt-histogram')).toBeTruthy();

    await tree.rerender(panel({ histograms: { reverse: REVERSE } }));
    expect(tree.queryByTestId('attempt-histogram')).toBeNull();
    expect(tree.queryByTestId('chart-plot-histogram')).toBeNull();

    // The data returning does not bring the histogram back unasked.
    await tree.rerender(panel());
    expect(tree.queryByTestId('attempt-histogram')).toBeNull();
  });

  it('marks the highlighted attempt and the record on the histogram', async () => {
    const drawn = captureRects();
    const lines = captureLines();
    const tree = await render(panel({ highlightedActivityId: 'act-0' }));
    drawn.length = 0;
    lines.length = 0;
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    await layoutViews(tree, 400, 300);

    const green = lines.filter((l) => l.color === colors.chartGreenMark);
    const gold = lines.filter((l) => l.color === colors.chartGoldMark);
    expect(green).toHaveLength(1);
    expect(gold).toHaveLength(1);
    // 305 s and 310 s both fall in the first 30 s bin, 300 to 330.
    const [first] = barsOf(drawn);
    for (const mark of [green[0], gold[0]]) {
      const centre = markX(mark);
      expect(centre).toBeGreaterThanOrEqual(Number(first.x));
      expect(centre).toBeLessThan(Number(first.x) + Number(first.width));
    }
  });

  it('shows the scatter legend under the scatter only', async () => {
    const tree = await render(panel({ highlightedActivityId: 'act-0', bestForwardIsRecord: true }));
    expect(tree.queryByText('sections.legendPr')).toBeTruthy();

    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    // The histogram carries its own key, with the same two entries.
    expect(tree.queryAllByText('sections.legendPr')).toHaveLength(1);
    expect(tree.queryAllByText('sections.legendThisActivity')).toHaveLength(1);
    expect(tree.queryByText('sections.legendReverse')).toBeNull();
  });
});

describe('AttemptHistogramChart', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws two bars in the ratio 3:2 with the attempt mark in the first bin', async () => {
    const drawn = captureRects();
    const lines = captureLines();
    const tree = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30)}
        activityType="Ride"
        isDark={false}
        highlightedTime={305}
        recordTime={355}
      />
    );
    await layoutViews(tree, 400, 300);

    const bars = barsOf(drawn);
    expect(bars).toHaveLength(2);
    expect(Number(bars[0].height) / Number(bars[1].height)).toBeCloseTo(3 / 2);
    const green = lines.find((l) => l.color === colors.chartGreenMark)!;
    const gold = lines.find((l) => l.color === colors.chartGoldMark)!;
    expect(markX(green)).toBeLessThan(Number(bars[0].x) + Number(bars[0].width));
    expect(markX(gold)).toBeGreaterThan(Number(bars[1].x));
  });

  it('draws the record mark dashed and the attempt mark solid, and keys them the same way', async () => {
    const drawn = captureLines();
    const tree = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30)}
        activityType="Ride"
        isDark={false}
        highlightedTime={305}
        recordTime={308}
        recordHeld
      />
    );
    await layoutViews(tree, 400, 300);

    const record = drawn.find((l) => l.color === colors.chartGoldMark);
    const attempt = drawn.find((l) => l.color === colors.chartGreenMark);
    expect(record).toBeDefined();
    expect(attempt).toBeDefined();
    expect(isDashed(record!)).toBe(true);
    expect(isDashed(attempt!)).toBe(false);

    const recordKey = within(tree.getByTestId('attempt-histogram-record-key'));
    const attemptKey = within(tree.getByTestId('attempt-histogram-highlight-key'));
    expect(recordKey.getByTestId('key-swatch-dashed')).toBeTruthy();
    expect(recordKey.queryByTestId('key-swatch-solid')).toBeNull();
    expect(attemptKey.getByTestId('key-swatch-solid')).toBeTruthy();
    expect(attemptKey.queryByTestId('key-swatch-dashed')).toBeNull();
  });

  it('draws no mark for a time outside the bins', async () => {
    const drawn = captureRects();
    const lines = captureLines();
    const tree = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30)}
        activityType="Ride"
        isDark={false}
        highlightedTime={900}
      />
    );
    await layoutViews(tree, 400, 300);

    expect(barsOf(drawn)).toHaveLength(2);
    expect(lines.filter((l) => l.color === colors.chartGreenMark)).toHaveLength(0);
  });

  it('says what is outside the distance band only when the engine reports some', async () => {
    const outside = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30, { unbinnedOutsideBand: 2 })}
        activityType="Ride"
        isDark={false}
        useTimeAxis
      />
    );
    expect(outside.getByTestId('attempt-histogram-outside-band').props.children).toContain(
      '"attempts":2'
    );

    const within = await render(
      <AttemptHistogramChart histogram={bins([3, 2], 300, 30)} activityType="Ride" isDark={false} />
    );
    expect(within.queryByTestId('attempt-histogram-outside-band')).toBeNull();
  });

  it('labels a section axis in the scatter unit and a route axis as durations', async () => {
    const edgeSpeeds = [10, 5, 2.5];
    const section = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30, { edgeSpeeds })}
        activityType="Ride"
        isDark={false}
      />
    );
    expect(section.queryByText('5:00')).toBeNull();

    const route = await render(
      <AttemptHistogramChart
        histogram={bins([3, 2], 300, 30)}
        activityType="Ride"
        isDark={false}
        useTimeAxis
      />
    );
    expect(route.getByText('5:00')).toBeTruthy();
    expect(route.getByText('6:00')).toBeTruthy();
  });
});

describe('the route page chart', () => {
  it('mounts the panel and offers the plot switch', async () => {
    const tree = await render(
      <SectionPerformanceSection
        subject="route"
        chartData={CHART_DATA}
        trendCurves={{}}
        histograms={HISTOGRAMS}
        sportType="Ride"
        isDark={false}
        bestForwardRecord={null}
        bestReverseRecord={null}
        bestForwardIsRecord={false}
        bestReverseIsRecord={false}
        forwardStats={null}
        reverseStats={null}
        onActivitySelect={jest.fn()}
        onExcludeActivity={jest.fn()}
        onIncludeActivity={jest.fn()}
        onSetAsReference={jest.fn()}
        referenceActivityId={undefined}
        showExcluded={false}
        hasExcluded={false}
        onToggleShowExcluded={jest.fn()}
        sectionTimeRange="all"
        onTimeRangeChange={jest.fn()}
      />
    );

    expect(tree.getByTestId('performance-chart-panel')).toBeTruthy();
    await fireEvent.press(tree.getByTestId('chart-plot-histogram'));
    expect(tree.getByTestId('attempt-histogram')).toBeTruthy();
  });
});
