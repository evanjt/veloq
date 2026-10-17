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
import {
  summaryComparison,
  trainingScreenRead,
  wallSeconds,
} from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

/** Totals for any window: three activities, or none. */
function totals(count: number) {
  return { count, totalDuration: count * 3600, totalDistance: count * 20000, totalTss: count * 40 };
}

/** The windows the engine answers for Wednesday 17 June 2026 at noon. */
const NOON = new Date(2026, 5, 17, 12);
const WINDOWS = {
  week: [new Date(2026, 5, 15), new Date(2026, 5, 8), new Date(2026, 5, 10, 12)],
  month: [new Date(2026, 5, 1), new Date(2026, 4, 1), new Date(2026, 4, 17, 12)],
  year: [new Date(2026, 0, 1), new Date(2025, 0, 1), new Date(2025, 5, 17, 12)],
} as const;

/** How many activities every window the read answers holds. */
let held = 3;

const engine = {
  getTrainingScreenData: trainingScreenRead({
    comparisons: (now) => {
      const of = ([currentStart, previousStart, previousEnd]: readonly [Date, Date, Date]) =>
        summaryComparison(now, {
          current: { startTs: wallSeconds(currentStart), endTs: wallSeconds(NOON) },
          previous: { startTs: wallSeconds(previousStart), endTs: wallSeconds(previousEnd) },
          currentStats: totals(held),
          previousStats: totals(held),
        });
      return { week: of(WINDOWS.week), month: of(WINDOWS.month), year: of(WINDOWS.year) };
    },
  }),
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
  jest.setSystemTime(NOON);
  held = 3;
  engine.rangeCoverage.mockImplementation(() => RangeCoverage.Loaded);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('WeeklySummary over a range never downloaded', () => {
  it('asks the census about each period it compares, by its own dates', async () => {
    const view = await render(<WeeklySummary />, { wrapper });

    await fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    // The clock is set to noon on Wednesday 17 June 2026, local time.
    await waitFor(() =>
      expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-06-01', '2026-06-17')
    );
    expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-05-01', '2026-05-17');
  });

  it('says a month never downloaded is not downloaded, not empty', async () => {
    held = 0;
    coverageBy({ '2026-06-01': RangeCoverage.NotFetched });

    const view = await render(<WeeklySummary />, { wrapper });
    await fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    await waitFor(() => expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy());
    expect(view.queryByText('stats.noActivitiesInPeriod')).toBeNull();
  });

  it('keeps the empty state for a month the census says is empty', async () => {
    held = 0;
    coverageBy({ '2026-06-01': RangeCoverage.Empty });

    const view = await render(<WeeklySummary />, { wrapper });
    await fireEvent.press(view.getByTestId('weekly-summary-range-month'));

    await waitFor(() => expect(view.getByText('stats.noActivitiesInPeriod')).toBeTruthy());
    expect(view.queryByText('stats.rangeNotDownloaded')).toBeNull();
  });

  it('adds a quiet line when the year is partly downloaded', async () => {
    coverageBy({ '2026-01-01': RangeCoverage.NotFetched });

    const view = await render(<WeeklySummary />, { wrapper });
    await fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-partial')).toBeTruthy();
  });

  it('adds the quiet line when the period compared against is not downloaded', async () => {
    coverageBy({ '2025-01-01': RangeCoverage.NotFetched });

    const view = await render(<WeeklySummary />, { wrapper });
    await fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-partial')).toBeTruthy();
  });

  it('carries no line when both periods are downloaded', async () => {
    const view = await render(<WeeklySummary />, { wrapper });
    await fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByTestId('weekly-summary-count')).toBeTruthy());
    expect(view.queryByTestId('weekly-summary-partial')).toBeNull();
  });

  it('asks the census about this week so far and last week to the same weekday', async () => {
    await render(<WeeklySummary />, { wrapper });

    await waitFor(() =>
      expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-06-15', '2026-06-17')
    );
    expect(engine.rangeCoverage).toHaveBeenCalledWith('2026-06-08', '2026-06-10');
  });

  it('says a week never downloaded is not downloaded, not empty', async () => {
    held = 0;
    coverageBy({ '2026-06-15': RangeCoverage.NotFetched });

    const view = await render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(view.getByText('stats.rangeNotDownloaded')).toBeTruthy());
  });
});
