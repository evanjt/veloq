/**
 * Scenario: the season chart plots the last two calendar years month by month.
 * It summed a parsed array of every activity body in that window to do it.
 *
 * Expected behaviour: the twenty-four bars come from the engine's own monthly
 * aggregate. No body is read and none is parsed, so the cost is the bars rather
 * than the library.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useUnitPreference } from '@/shared/app/UnitPreferenceStore';
import { SeasonComparison } from '@/features/stats/components/SeasonComparison';
import { getEngine } from '@/shared/native/engine';
import { CLOCK_EDGES, localDay } from '../__shared__/clockEdges';
import { trainingScreenRead } from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
// The chart reads the theme through the app barrel, which reaches the IAP module.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const YEAR = new Date().getFullYear();

const ROWS = [
  {
    year: YEAR - 1,
    month: 1,
    stats: { count: 2, totalDuration: 7200, totalDistance: 60000, totalTss: 75 },
  },
  {
    year: YEAR,
    month: 1,
    stats: { count: 1, totalDuration: 3600, totalDistance: 40000, totalTss: 50 },
  },
  {
    year: YEAR,
    month: 3,
    stats: { count: 1, totalDuration: 10800, totalDistance: 90000, totalTss: 120 },
  },
];

/** Sums the monthly fixture over the months that start inside a window. */
function periodFrom(startTs: number, endTs: number) {
  const inside = ROWS.filter((r) => {
    const first = Date.UTC(r.year, r.month - 1, 1) / 1000;
    return first >= startTs && first <= endTs;
  });
  const sum = (key: 'totalDuration' | 'totalDistance' | 'totalTss') =>
    inside.reduce((acc, r) => acc + r.stats[key], 0);
  return {
    count: inside.length,
    totalDuration: sum('totalDuration'),
    totalDistance: sum('totalDistance'),
    totalTss: sum('totalTss'),
  };
}

/** The monthly rows of the training screen read, asked over the span it names. */
const monthlyRows = jest.fn((_startTs: number, _endTs: number) => ROWS);

const engine = {
  getTrainingScreenData: trainingScreenRead({ months: monthlyRows, period: periodFrom }),
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

describe('SeasonComparison', () => {
  it('totals the year from the engine aggregate, with no activities given', async () => {
    const view = render(<SeasonComparison />, { wrapper });

    // 3600 + 10800 seconds this year, 7200 last, in hours to one decimal.
    await waitFor(() => expect(view.getByText('4h')).toBeTruthy());
    expect(view.getByText('2h')).toBeTruthy();
  });

  it.each([
    ['metric', '130', '60', 'km'],
    ['imperial', '80.8', '37.3', 'mi'],
  ] as const)(
    'totals the distance in %s units, labelled in the unit it is read in',
    async (preference, current, previous, unit) => {
      useUnitPreference.setState({ unitPreference: preference });
      const view = render(<SeasonComparison />, { wrapper });
      await waitFor(() => expect(view.getByText('4h')).toBeTruthy());

      fireEvent.press(view.getByText('activity.distance'));

      await waitFor(() => expect(view.getByText(`${current}${unit}`)).toBeTruthy());
      expect(view.getByText(`${previous}${unit}`)).toBeTruthy();
    }
  );

  it('reads no activity bodies', async () => {
    render(<SeasonComparison />, { wrapper });

    await waitFor(() => expect(monthlyRows).toHaveBeenCalled());
    expect(engine.getActivityBodies).not.toHaveBeenCalled();
  });

  it('asks the engine for the two calendar years the chart shows', async () => {
    render(<SeasonComparison />, { wrapper });

    await waitFor(() => expect(monthlyRows).toHaveBeenCalled());
    const [startTs, endTs] = monthlyRows.mock.calls[0] as unknown as [number, number];
    expect(new Date(startTs * 1000).getUTCFullYear()).toBe(YEAR - 1);
    expect(new Date(startTs * 1000).getUTCMonth()).toBe(0);
    expect(endTs).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) - 86400);
  });
});

describe.each(CLOCK_EDGES)('SeasonComparison on %s', (_name, at) => {
  beforeEach(() => jest.setSystemTime(at));

  it('asks for 1 January last year through the end of today, by the local calendar', async () => {
    render(<SeasonComparison />, { wrapper });

    await waitFor(() => expect(monthlyRows).toHaveBeenCalled());
    const [startTs, endTs] = monthlyRows.mock.calls[0] as unknown as [number, number];
    expect(new Date(startTs * 1000).toISOString()).toBe(
      `${at.getFullYear() - 1}-01-01T00:00:00.000Z`
    );
    expect(new Date(endTs * 1000).toISOString()).toBe(`${localDay(at)}T23:59:59.000Z`);
  });
});
