/**
 * Scenario: a screen reader meets a drawn chart. The canvas itself says nothing, so the plot has
 * to carry a sentence and a way to the numbers behind it.
 *
 * Expected behaviour: the plot is one image whose label is the chart's summary, it offers a
 * Show data action and a visible Show data button, and either opens the table sheet with one
 * row per plotted point.
 */

import React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ChartDataSheet from '@/app/sheets/chart-data';
import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { CurveChart } from '@/shared/charts';
import * as formatModule from '@/shared/format/format';
import { initialiseI18n } from '@/i18n';
import type { FeedCard, ActivityStreams as StreamsData, MuscleVolume, WellnessData } from '@/types';
import { dayActivityRow } from '@/features/activity/light';

const mockPush = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const FITNESS_DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 43, atl: 55 },
] as WellnessData[];

// Resting HR on four days, HRV on two of them: every day with any reading is a row.
const WELLNESS_DAYS: WellnessData[] = [
  { id: '2026-06-01', restingHR: 50, hrv: 61 },
  { id: '2026-06-02', restingHR: 51 },
  { id: '2026-06-03', restingHR: 49, hrv: 70 },
  { id: '2026-06-04', restingHR: 48 },
  { id: '2026-06-05' },
];

const CURVE = [
  { x: 5, y: 900 },
  { x: 60, y: 450 },
  { x: 300, y: 320 },
  { x: 1200, y: 270 },
];

jest.mock('@/shared/app/useMetricSystem', () => ({ useMetricSystem: () => true }));
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-linear-gradient', () => ({
  ...jest.requireActual('expo-linear-gradient'),
  LinearGradient: () => null,
}));
jest.mock('@/theme', () => {
  const real = jest.requireActual('@/theme/colors');
  return {
    ...jest.requireActual('@/theme'),
    bodyDiagram: real.bodyDiagram,
    sequentialRamp: real.sequentialRamp,
    loupeChrome: real.loupeChrome,
  };
});

// Five days, two of them with a session and a two-day break between.
const STRIP_DAYS = [
  { id: '2026-05-01', ctl: 30, atl: 30 },
  { id: '2026-05-02', ctl: 30, atl: 30 },
  { id: '2026-05-03', ctl: 30, atl: 30 },
  { id: '2026-05-04', ctl: 30, atl: 30 },
  { id: '2026-05-05', ctl: 30, atl: 30 },
] as WellnessData[];
const STRIP_ACTIVITIES = [
  { id: 'g1', name: 'Glaze run', sportType: 'Run', startDateLocal: '2026-05-01T07:00:00' },
  { id: 'g2', name: 'Kiln ride', sportType: 'Ride', startDateLocal: '2026-05-04T07:00:00' },
  { id: 'g3', name: 'Clay swim', sportType: 'Swim', startDateLocal: '2026-05-04T18:00:00' },
] as FeedCard[];

const volume = (slug: string, weightedSets: number): MuscleVolume => ({
  slug,
  primarySets: weightedSets,
  secondarySets: 0,
  weightedSets,
  totalReps: 10,
  volumeKg: 100,
  exerciseNames: [],
  shade: 3,
});

// Ten samples a kilometre apart, power climbing by 10 W from 200 W.
const KILN_RIDE: StreamsData = {
  time: Float64Array.from({ length: 10 }, (_, i) => i * 120),
  distance: Float64Array.from({ length: 10 }, (_, i) => i * 1000),
  watts: Float64Array.from({ length: 10 }, (_, i) => 200 + i * 10),
};

/** Lays out the first view that measures itself, as a chart's box would be on screen. */
async function layOut(width = 320) {
  const box = screen.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  await act(async () => {
    await fireEvent(box!, 'layout', { nativeEvent: { layout: { width, height: 180 } } });
  });
}

beforeAll(async () => {
  await initialiseI18n();
});
beforeEach(() => {
  mockPush.mockClear();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
});

function plot() {
  return screen.findByRole('image', { name: /, / });
}

async function openThroughAction() {
  const surface = await plot();
  expect(surface.props.accessibilityActions).toEqual(
    expect.arrayContaining([{ name: 'showData', label: 'Show data' }])
  );
  await act(async () => {
    surface.props.onAccessibilityAction({ nativeEvent: { actionName: 'showData' } });
  });
  return openedSheet();
}

async function openThroughButton() {
  await fireEvent.press(screen.getByRole('button', { name: 'Show data' }));
  return openedSheet();
}

async function openedSheet() {
  const call = mockPush.mock.calls.at(-1)?.[0];
  expect(call?.pathname).toBe('sheets/chart-data');
  mockParams = { request: call.params.request };
  await render(<ChartDataSheet />);
  return screen.getAllByTestId(/^chart-data-row-/);
}

describe('a chart can be read without seeing it', () => {
  vaultIt('speaks the fitness chart and opens one row per plotted day', async () => {
    await render(<FitnessChart data={FITNESS_DAYS} />);
    expect((await plot()).props.accessibilityLabel).toMatch(
      /Fitness.*latest 43.*Fatigue.*latest 55/
    );
    const rows = await openThroughAction();
    expect(rows).toHaveLength(FITNESS_DAYS.length);
  });

  vaultIt('keeps the fitness sheet behind its action once the visible button is gone', async () => {
    await render(<FitnessChart data={FITNESS_DAYS} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
    expect(await openThroughAction()).toHaveLength(FITNESS_DAYS.length);
  });

  vaultIt('speaks a curve chart and opens one row per plotted point', async () => {
    await render(
      <CurveChart
        data={CURVE}
        yDomain={[0, 1000]}
        color="#336699"
        xLabels={[]}
        formatY={(v) => `${Math.round(v)} W`}
        reading={{
          title: 'Kiln output',
          xHeader: 'Duration',
          unit: 'W',
          formatX: (x) => `${x} s`,
          shape: 'curve',
        }}
      />
    );
    expect((await plot()).props.accessibilityLabel).toBe(
      'Kiln output, 5 s to 1200 s: 900 W at 5 s, 270 W at 1200 s, peak 900 W'
    );
    const rows = await openThroughAction();
    expect(rows).toHaveLength(CURVE.length);
    expect(screen.getByText('Kiln output (W)')).toBeTruthy();
  });

  vaultIt('speaks every wellness lane and opens one row per day with a reading', async () => {
    await render(
      <WellnessTrendsChart data={WELLNESS_DAYS} timeRange="7d" smoothingWindow="none" />
    );
    expect((await plot()).props.accessibilityLabel).toMatch(
      /HRV.*latest 70.*Resting HR.*latest 48/
    );
    const rows = await openThroughButton();
    expect(rows).toHaveLength(4);
  });

  it("lists each day's own reading in the table, not the smoothed line drawn through it", async () => {
    await render(
      <WellnessTrendsChart
        data={[
          { id: '2026-06-01', hrv: 40 },
          { id: '2026-06-02', hrv: 80 },
          { id: '2026-06-03', hrv: 40 },
        ]}
        timeRange="7d"
        smoothingWindow={3}
      />
    );
    const rows = await openThroughButton();
    expect(rows[1]).toHaveTextContent(/80 ms$/);
    expect(rows[1]).not.toHaveTextContent(/53 ms/);
  });

  vaultIt(
    'speaks each drawn activity stream in its unit and opens one row per plotted point',
    async () => {
      await render(
        <ActivityStreams
          streams={KILN_RIDE}
          elevationGain={0}
          selectedCharts={['power']}
          chartConfigs={CHART_CONFIGS}
        />
      );
      await layOut();
      expect((await plot()).props.accessibilityLabel).toBe(
        'Activity chart. Power, 0.00 km to 9.00 km: latest 290 W, range 200 W to 290 W, average 245 W'
      );
      const rows = await openThroughAction();
      expect(rows).toHaveLength(10);
      expect(screen.getByText('Power (W)')).toBeTruthy();
    }
  );

  vaultIt('keeps the activity chart axis values from a screen reader', async () => {
    await render(
      <ActivityStreams
        streams={KILN_RIDE}
        elevationGain={0}
        selectedCharts={['power']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    await layOut();
    expect(
      screen.getByTestId('activity-lane-power-max', { includeHiddenElements: true })
    ).toBeTruthy();
    expect(screen.queryByTestId('activity-lane-power-max')).toBeNull();
    expect(screen.queryByText('245')).toBeNull();
  });

  vaultIt(
    'speaks the days trained with its longest break and draws no Show data link',
    async () => {
      await render(
        <ActivityDotsChart data={STRIP_DAYS} activities={STRIP_ACTIVITIES.map(dayActivityRow)} />
      );
      expect((await plot()).props.accessibilityLabel).toBe(
        'Days trained, May 1 to May 5: active on 2 of 5 days. Longest break 2 days'
      );
      expect(screen.queryByTestId('activity-dots-plot-show-data')).toBeNull();
    }
  );

  vaultIt('speaks each trained muscle and opens one row per muscle', async () => {
    await render(
      <StrengthBodyDiagram
        bodyData={[]}
        volumes={[volume('chest', 4), volume('abs', 9)]}
        gender="male"
        maxWeightedSets={9}
        selectedVolume={null}
        tappableSlugs={new Set(['chest', 'abs'])}
        onMuscleTap={jest.fn()}
        onMuscleScrub={jest.fn()}
        onClearSelection={jest.fn()}
      />
    );
    expect(screen.getByTestId('strength-body-plot').props.accessibilityLabel).toMatch(
      /^Muscle group volume: Abs 9 sets, Chest 4 sets$/
    );
    expect(screen.getByRole('adjustable')).toBeTruthy();
    const rows = await openThroughButton();
    expect(rows).toHaveLength(2);
  });

  vaultIt('offers no table when the chart has nothing to plot', async () => {
    await render(<FitnessChart data={[]} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
  });
});

describe('building the reading on demand', () => {
  function days(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      ctl: 40 + i,
      atl: 48 + i,
    }));
  }

  async function labelCalls(count: number): Promise<number> {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const spy = jest.spyOn(formatModule, 'formatShortDate');
    spy.mockClear();
    await render(<FitnessChart data={days(count)} />);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    screen.unmount();
    return calls;
  }

  it('does not label a day per day shown while no screen reader is on', async () => {
    const few = await labelCalls(10);
    const many = await labelCalls(90);
    expect(many).toBe(few);
  });
});
