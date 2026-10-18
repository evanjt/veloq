/**
 * Scenario: a screen reader meets a drawn chart. The canvas itself says nothing, so the plot has
 * to carry a sentence and a way to the numbers behind it.
 *
 * Expected behaviour: the plot is one image whose label is the chart's summary, it offers a
 * Show data action and a visible Show data button, and either opens the table sheet with one
 * row per plotted point.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ChartDataSheet from '@/app/sheets/chart-data';
import { ActivityStreams } from '@/features/activity/components/ActivityStreams';
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { StrengthBodyDiagram } from '@/features/strength/components/StrengthBodyDiagram';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { CurveChart } from '@/shared/charts';
import { initialiseI18n } from '@/i18n';
import type { Activity, ActivityStreams as StreamsData, MuscleVolume, WellnessData } from '@/types';
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
  { id: 'g1', name: 'Glaze run', type: 'Run', start_date_local: '2026-05-01T07:00:00' },
  { id: 'g2', name: 'Kiln ride', type: 'Ride', start_date_local: '2026-05-04T07:00:00' },
  { id: 'g3', name: 'Clay swim', type: 'Swim', start_date_local: '2026-05-04T18:00:00' },
] as Activity[];

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
});

function plot() {
  return screen.getByRole('image', { name: /, / });
}

async function openThroughAction() {
  const surface = plot();
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
  it('speaks the fitness chart and opens one row per plotted day', async () => {
    await render(<FitnessChart data={FITNESS_DAYS} />);
    expect(plot().props.accessibilityLabel).toMatch(/Fitness.*latest 43.*Fatigue.*latest 55/);
    const rows = await openThroughAction();
    expect(rows).toHaveLength(FITNESS_DAYS.length);
  });

  it('opens the same sheet from the visible fitness button', async () => {
    await render(<FitnessChart data={FITNESS_DAYS} />);
    expect(await openThroughButton()).toHaveLength(FITNESS_DAYS.length);
  });

  it('speaks a curve chart and opens one row per plotted point', async () => {
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
    expect(plot().props.accessibilityLabel).toBe(
      'Kiln output, 5 s to 1200 s: 900 W at 5 s, 270 W at 1200 s, peak 900 W.'
    );
    const rows = await openThroughAction();
    expect(rows).toHaveLength(CURVE.length);
    expect(screen.getByText('Kiln output (W)')).toBeTruthy();
  });

  it('speaks every wellness lane and opens one row per day with a reading', async () => {
    await render(
      <WellnessTrendsChart data={WELLNESS_DAYS} timeRange="7d" smoothingWindow="none" />
    );
    expect(plot().props.accessibilityLabel).toMatch(/HRV.*latest 70.*Resting HR.*latest 48/);
    const rows = await openThroughButton();
    expect(rows).toHaveLength(4);
  });

  it('speaks each drawn activity stream in its unit and opens one row per plotted point', async () => {
    await render(
      <ActivityStreams
        streams={KILN_RIDE}
        elevationGain={0}
        selectedCharts={['power']}
        chartConfigs={CHART_CONFIGS}
      />
    );
    await layOut();
    expect(plot().props.accessibilityLabel).toBe(
      'Activity chart. Power, 0.00 km to 9.00 km: latest 290 W, range 200 W to 290 W, average 245 W.'
    );
    const rows = await openThroughAction();
    expect(rows).toHaveLength(10);
    expect(screen.getByText('Power (W)')).toBeTruthy();
  });

  it('keeps the activity chart axis values from a screen reader', async () => {
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

  it('speaks the days trained with its longest break and lists each day trained', async () => {
    await render(
      <ActivityDotsChart data={STRIP_DAYS} activities={STRIP_ACTIVITIES.map(dayActivityRow)} />
    );
    expect(plot().props.accessibilityLabel).toBe(
      'Days trained, May 1 to May 5: active on 2 of 5 days. Longest break 2 days.'
    );
    const rows = await openThroughButton();
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Kiln ride, Clay swim')).toBeTruthy();
  });

  it('speaks each trained muscle and opens one row per muscle', async () => {
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
      /^Muscle group volume: Abs 9 sets, Chest 4 sets\.$/
    );
    expect(screen.getByRole('adjustable')).toBeTruthy();
    const rows = await openThroughButton();
    expect(rows).toHaveLength(2);
  });

  it('offers no table when the chart has nothing to plot', async () => {
    await render(<FitnessChart data={[]} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
  });
});
