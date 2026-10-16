/**
 * Scenario: a screen reader meets a drawn chart. The canvas itself says nothing, so the plot has
 * to carry a sentence and a way to the numbers behind it.
 *
 * Expected behaviour: the plot is one image whose label is the chart's summary, it offers a
 * Show data action and a visible Show data button, and either opens the table sheet with one
 * row per plotted point.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ChartDataSheet from '@/app/sheets/chart-data';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { CurveChart } from '@/shared/charts';
import { initialiseI18n } from '@/i18n';
import type { WellnessData } from '@/types';

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

  it('offers no table when the chart has nothing to plot', async () => {
    await render(<FitnessChart data={[]} />);
    expect(screen.queryByRole('button', { name: 'Show data' })).toBeNull();
  });
});
