/**
 * Scenario: the Health tab's summary compares a period against the one before
 * it. For every range but the calendar week it summed a parsed array of every
 * activity body in twenty-one months to do it.
 *
 * Expected behaviour: those two totals come from the engine, one aggregate read
 * per period. The calendar week still prefers the athlete-summary endpoint,
 * which is what intervals.icu's own week is.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/features/fitness/hooks', () => ({
  ...jest.requireActual('@/features/fitness/hooks'),
  useAthleteSummary: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

/** What the athlete-summary endpoint gives for the calendar week. */
const SUMMARY = {
  currentWeek: { count: 5, moving_time: 9000, distance: 80000, training_load: 120 },
  previousWeek: { count: 4, moving_time: 7000, distance: 60000, training_load: 100 },
};

const engine = {
  getPeriodStats: jest.fn((startTs: number) => ({
    count: startTs > 0 ? 3 : 0,
    totalDuration: 7200,
    totalDistance: 60000,
    totalTss: 90,
  })),
  getActivityBodies: jest.fn(() => []),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('WeeklySummary', () => {
  it('reads a year from the engine rather than from parsed bodies', async () => {
    const view = render(<WeeklySummary />, { wrapper });

    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(engine.getPeriodStats).toHaveBeenCalled());
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('asks for the current period and the one before it, and no more', async () => {
    const view = render(<WeeklySummary />, { wrapper });
    await waitFor(() => expect(engine.getPeriodStats).toHaveBeenCalled());
    engine.getPeriodStats.mockClear();

    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(engine.getPeriodStats.mock.calls.length).toBe(2));
    const windows = engine.getPeriodStats.mock.calls.map((c) => (c as unknown as number[])[0]);
    expect(new Set(windows).size).toBe(2);
  });

  it('takes the athlete-summary week over an engine read when it has one', async () => {
    jest
      .requireMock('@/features/fitness/hooks')
      .useAthleteSummary.mockReturnValue({ data: SUMMARY, isLoading: false });

    render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(engine.subscribe).toHaveBeenCalled());
    expect(engine.getPeriodStats).not.toHaveBeenCalled();
  });

  it('shows the engine totals for the period', async () => {
    const view = render(<WeeklySummary />, { wrapper });

    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  });
});
