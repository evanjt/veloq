/**
 * Scenario: an account with years of rides on a device that has downloaded
 * ninety days. The summary on `month` or `year` totals what is held and, for a
 * period the device never pulled, says there were no activities in it.
 *
 * Expected behaviour: the census answers for each period's own dates. A period
 * never downloaded says so in place of the empty state, and a period partly
 * downloaded, or compared against one, carries a quiet line under the totals.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/features/fitness/hooks', () => ({
  ...jest.requireActual('@/features/fitness/hooks'),
  useAthleteSummary: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

const SUMMARY = {
  currentWeek: { count: 5, moving_time: 9000, distance: 80000, training_load: 120 },
  previousWeek: { count: 4, moving_time: 7000, distance: 60000, training_load: 100 },
};

/** Totals for any window: three activities, or none. */
function totals(count: number) {
  return { count, totalDuration: count * 3600, totalDistance: count * 20000, totalTss: count * 40 };
}

const engine = {
  getPeriodStats: jest.fn(() => totals(3)),
  rangeCoverage: jest.fn((_oldest: string, _newest: string) => RangeCoverage.Loaded),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

/** The census answer for the window starting `oldest`, by its first day. */
function coverageBy(answers: Record<string, RangeCoverage>) {
  engine.rangeCoverage.mockImplementation(
    (oldest: string) => answers[oldest] ?? RangeCoverage.Loaded
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Local noon, so the date is the 17th in every zone; the suite's UTC instant is the 18th east of UTC+12.
  jest.setSystemTime(new Date(2026, 5, 17, 12));
  engine.getPeriodStats.mockImplementation(() => totals(3));
  engine.rangeCoverage.mockImplementation(() => RangeCoverage.Loaded);
  jest
    .requireMock('@/features/fitness/hooks')
    .useAthleteSummary.mockReturnValue({ data: undefined, isLoading: false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('WeeklySummary over a range never downloaded', () => {
  it('asks the census about each period it compares, by its own dates', async () => {
    const view = render(<WeeklySummary />, { wrapper });

    fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    // The clock is set to noon on Wednesday 17 June 2026, local time.
    await waitFor(() =>
      expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-06-01', '2026-06-17')
    );
    expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-05-01', '2026-05-17');
  });

  it('says a month never downloaded is not downloaded, not empty', async () => {
    engine.getPeriodStats.mockImplementation(() => totals(0));
    coverageBy({ '2026-06-01': RangeCoverage.NotFetched });

    const view = render(<WeeklySummary />, { wrapper });
    fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    await waitFor(() => expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy());
    expect(view.queryByText('stats.noActivitiesInPeriod')).toBeNull();
  });

  it('keeps the empty state for a month the census says is empty', async () => {
    engine.getPeriodStats.mockImplementation(() => totals(0));
    coverageBy({ '2026-06-01': RangeCoverage.Empty });

    const view = render(<WeeklySummary />, { wrapper });
    fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    await waitFor(() => expect(view.getByText('stats.noActivitiesInPeriod')).toBeTruthy());
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });

  it('adds a quiet line when the year is partly downloaded', async () => {
    coverageBy({ '2026-01-01': RangeCoverage.NotFetched });

    const view = render(<WeeklySummary />, { wrapper });
    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-partial')).toBeTruthy();
  });

  it('adds the quiet line when the period compared against is not downloaded', async () => {
    coverageBy({ '2025-01-01': RangeCoverage.NotFetched });

    const view = render(<WeeklySummary />, { wrapper });
    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-partial')).toBeTruthy();
  });

  it('carries no line when both periods are downloaded', async () => {
    const view = render(<WeeklySummary />, { wrapper });
    fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.queryByTestId('weekly-summary-partial')).toBeNull();
  });

  it('does not call the week the athlete summary answers undownloaded, only the span before it', async () => {
    engine.rangeCoverage.mockImplementation(() => RangeCoverage.NotFetched);
    jest
      .requireMock('@/features/fitness/hooks')
      .useAthleteSummary.mockReturnValue({ data: SUMMARY, isLoading: false });

    const view = render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-partial')).toBeTruthy();
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });

  it('carries no line on that week when the span before it is downloaded', async () => {
    jest
      .requireMock('@/features/fitness/hooks')
      .useAthleteSummary.mockReturnValue({ data: SUMMARY, isLoading: false });

    const view = render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.queryByTestId('weekly-summary-partial')).toBeNull();
  });
});
