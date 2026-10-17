/**
 * Scenario: an exercise's history drew its estimated one-rep max as a bare
 * line with no axis, no dates and no readout, under a native title and a
 * second in-body headline that both named the screen.
 *
 * Expected behaviour: the trend is the shared scrubbable chart, with value
 * ticks in the athlete's weight unit, the newest estimate as its readout and
 * no area under the line. The native title is the exercise's name, and no
 * headline in the body repeats it.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { CurveChart } from '@/shared/charts';
import ExerciseDetailScreen from '@/features/strength/components/ExerciseDetailScreen';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: require('../__shared__/nativeHeaderStandIn').Stack,
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => ({ category: '7' }),
}));

let mockMetric = true;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => mockMetric,
}));

const DAY = 86_400;
const START = Date.UTC(2026, 2, 2) / 1000;

let mockDetail: unknown = null;
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({
    data: mockDetail,
    isLoading: mockDetail == null,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

function detail(estimates: number[]) {
  return {
    exerciseCategory: 7,
    exerciseName: 'Kettlebell swing',
    sessions: estimates.map((estimate, i) => ({
      activityId: `swing-${i}`,
      activityName: `Garage circuit ${i}`,
      date: START + i * 9 * DAY,
      bestSet: { reps: 10, weightKg: 24 },
      estimatedOneRepMaxKg: estimate,
    })),
  };
}

async function layout() {
  const measured = screen.UNSAFE_getAllByType(View).filter((node) => node.props.onLayout);
  await act(async () => {
    for (const node of measured) {
      await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 150 } } });
    }
  });
}

describe('the exercise history trend', () => {
  beforeEach(() => {
    mockDetail = detail([30, 33.6]);
    mockMetric = true;
  });

  it('labels its value axis in kilograms and reads out the newest estimate', async () => {
    await render(<ExerciseDetailScreen />);
    await layout();

    expect(screen.UNSAFE_getAllByType(CurveChart)).toHaveLength(1);
    expect(screen.getByTestId('insight-series-axis-top').props.children).toMatch(/\d kg$/);
    expect(screen.getByTestId('insight-series-readout-value').props.children).toBe('33.6 kg');
  });

  it('labels its value axis in pounds for an imperial athlete', async () => {
    mockMetric = false;
    await render(<ExerciseDetailScreen />);
    await layout();

    expect(screen.getByTestId('insight-series-axis-top').props.children).toMatch(/\d lbs$/);
    expect(screen.getByTestId('insight-series-readout-value').props.children).toBe('74.1 lbs');
  });

  it('places the sessions on their dates and draws no area under the line', async () => {
    await render(<ExerciseDetailScreen />);

    const chart = screen.UNSAFE_getByType(CurveChart);
    expect(chart.props.data.map((d: { x: number }) => d.x)).toEqual([START, START + 9 * DAY]);
    expect(chart.props.area).toBe(false);
  });

  it('titles the native header with the exercise and repeats it nowhere in the body', async () => {
    await render(<ExerciseDetailScreen />);

    const header = screen.getByTestId('native-header');
    expect(within(header).getByRole('header').props.children).toBe('Kettlebell swing');
    expect(screen.getAllByText('Kettlebell swing')).toHaveLength(1);
  });

  it('falls back to the screen name while the history is still loading', async () => {
    mockDetail = null;
    await render(<ExerciseDetailScreen />);

    const header = screen.getByTestId('native-header');
    expect(within(header).getByRole('header').props.children).toBe('strength.history');
  });

  it('draws no trend for a single estimate', async () => {
    mockDetail = detail([30]);
    await render(<ExerciseDetailScreen />);

    expect(screen.UNSAFE_queryAllByType(CurveChart)).toHaveLength(0);
    expect(screen.getByText(/Garage circuit 0/)).toBeTruthy();
  });
});
