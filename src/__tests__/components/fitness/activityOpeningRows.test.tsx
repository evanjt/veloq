/**
 * Scenario: a row that opens an activity was drawn five ways. Season Bests
 * opened the activity from its name alone, a text link ending in an arrow
 * with a slop that left it short of a tap target, and dropped the date Best
 * Efforts shows for the same effort. The climbing rows used a ghost button
 * whose label carried the arrow, the strip above the days-trained chart a
 * pill ending in one, and the exercise history opened a session only from a
 * button standing in for its title.
 *
 * Expected behaviour: each opens the activity from a full-width row at least
 * a tap target tall, whose spoken label names the activity and carries no
 * arrow, and a best states the date it was set.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { ClimbingBestRows } from '@/features/fitness/components/ClimbingBestRows';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';
import { ActivityDotsChart } from '@/features/fitness/components/ActivityDotsChart';
import ExerciseDetailScreen from '@/features/strength/components/ExerciseDetailScreen';
import type { ClimbBest } from '@/features/stats';
import type { Activity, WellnessData } from '@/types';
import { layout } from '@/theme';

const mockPush = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => ({ category: '7' }),
}));

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({
    labels: new Map([['kite-day', { name: 'Kite session', date: '14 Feb 2026' }]]),
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({
    data: {
      exerciseName: 'Kettlebell swing',
      sessions: [
        {
          activityId: 'kettle-1',
          activityName: 'Garage circuit',
          date: 20500,
          bestSet: { reps: 12, weightKg: 24 },
          estimatedOneRepMaxKg: 33.6,
        },
      ],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

beforeEach(() => mockPush.mockClear());

const pushed = () => mockPush.mock.calls.map(([target]) => target);

function expectTapTargetRow(row: ReactTestInstance) {
  const style = StyleSheet.flatten(row.props.style);
  expect(style.minHeight).toBeGreaterThanOrEqual(layout.minTapTarget);
  expect(row.props.hitSlop).toBeUndefined();
}

function expectNoArrow() {
  expect(screen.queryAllByText(/→/, { includeHiddenElements: true })).toEqual([]);
  for (const button of screen.queryAllByRole('button')) {
    expect(button.props.accessibilityLabel ?? '').not.toMatch(/→/);
  }
}

describe('Season Bests', () => {
  it('states the date of a best and opens its activity from the whole row', async () => {
    await render(
      <SeasonBestsSection
        efforts={
          [
            { label: '1km', checkpoint: 1000, activityId: 'kite-day', value: 300, time: 180 },
          ] as never
        }
        sport="Cycling"
        period="6m"
        isLoading={false}
      />
    );

    expect(screen.getByText('14 Feb 2026')).toBeTruthy();
    const row = screen.getByTestId('season-bests-row-1000');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toMatch(/Kite session/);
    expect(row.props.accessibilityLabel).toMatch(/14 Feb 2026/);
    expectTapTargetRow(row);
    expectNoArrow();

    await fireEvent.press(row);
    expect(pushed()).toEqual(['/activity/kite-day']);
  });
});

describe('climbing bests', () => {
  it('states the date and opens the activity from the whole row', async () => {
    const bests = [
      { label: '10m', windowS: 600, vam: 1100, wattsPerKg: 3.2, activityId: 'kite-day' },
    ] as ClimbBest[];
    await render(<ClimbingBestRows bests={bests} sport="Running" />);

    expect(screen.getByText('14 Feb 2026')).toBeTruthy();
    const row = screen.getByTestId('season-bests-climbing-600');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toMatch(/Kite session/);
    expectTapTargetRow(row);
    expectNoArrow();

    await fireEvent.press(row);
    expect(pushed()).toEqual(['/activity/kite-day']);
  });
});

describe('the days-trained strip', () => {
  it('opens the chosen day activity from a row with no arrow', async () => {
    const wellness = [{ id: '2026-02-14', ctl: 40, atl: 50 }] as WellnessData[];
    const activities = [
      {
        id: 'kite-day',
        name: 'Kite session',
        type: 'Ride',
        start_date_local: '2026-02-14T07:00:00',
      },
    ] as Activity[];
    await render(
      <ActivityDotsChart data={wellness} activities={activities} selectedDate="2026-02-14" />
    );

    const row = screen.getByRole('button', { name: /Kite session/ });
    expectTapTargetRow(row);
    expectNoArrow();

    await fireEvent.press(row);
    expect(pushed()).toEqual(['/activity/kite-day']);
  });
});

describe('exercise history', () => {
  it('opens a session from a row that holds its numbers', async () => {
    await render(<ExerciseDetailScreen />);

    const row = screen.getByRole('button', { name: /Garage circuit/ });
    expectTapTargetRow(row);
    expect(row.props.accessibilityLabel).toMatch(/strength\.bestSet/);
    expect(screen.queryByText(/strength\.bestSet/)).toBeTruthy();
    expect(row).toContainElement(screen.getByText(/strength\.bestSet/));

    await fireEvent.press(row);
    expect(pushed()).toEqual(['/activity/kettle-1']);
  });
});
