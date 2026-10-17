/**
 * Scenario: the Health tab's summary judged its own arrows over windows it
 * built from whole calendar days, while the home card's engine read ended last
 * week at the same hour as now. On a Wednesday morning the two disagreed on the
 * same week, one up and one down.
 *
 * Expected behaviour: the summary paints every range's totals and arrows from
 * the training screen read, as the engine judged them, and a tap between ranges
 * reads nothing more.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { summaryComparison, trainingScreenRead } from '../__shared__/trainingScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const stats = (count: number, hours: number, km: number, load: number) => ({
  count,
  totalDuration: hours * 3600,
  totalDistance: km * 1000,
  totalTss: load,
});

const engine = {
  getTrainingScreenData: trainingScreenRead({
    comparisons: (now) => ({
      week: summaryComparison(now, {
        currentStats: stats(2, 1.5, 30, 80),
        previousStats: stats(2, 1, 30, 70),
        moves: {
          count: { glyph: '→' },
          duration: { glyph: '↑', percent: 50 },
          distance: { glyph: '→' },
          load: { glyph: '↑', percent: 14 },
        },
      }),
      year: summaryComparison(now, {
        currentStats: stats(40, 60, 900, 3000),
        previousStats: stats(50, 80, 1200, 3600),
        moves: { count: { glyph: '↓', percent: 20 } },
      }),
    }),
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

describe('WeeklySummary', () => {
  it('draws the week up when the engine judged it up, with its percentage', async () => {
    const view = await render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(view.getByTestId('weekly-summary-duration')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-duration-trend')).toHaveTextContent('↑ 50%');
    expect(view.getByText('vs last week so far')).toBeTruthy();
    // A flat move is drawn with no percentage.
    expect(view.getByTestId('weekly-summary-count-trend')).toHaveTextContent('→', {
      exact: true,
    });
  });

  it('asks the engine for the moment it reads, so last week ends at the same hour', async () => {
    await render(<WeeklySummary />, { wrapper });

    await waitFor(() => expect(engine.getTrainingScreenData).toHaveBeenCalled());
    const [windows] = engine.getTrainingScreenData.mock.calls[0];
    const now = new Date();
    const wall = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds()
    );
    expect(Math.abs(windows.nowWallSeconds * 1000 - wall)).toBeLessThan(5_000);
  });

  it('switches range from the one read rather than reading per range', async () => {
    const view = await render(<WeeklySummary />, { wrapper });
    await waitFor(() => expect(engine.getTrainingScreenData).toHaveBeenCalledTimes(1));

    await fireEvent.press(view.getByTestId('weekly-summary-range-year'));

    await waitFor(() => expect(view.getByText('40')).toBeTruthy());
    expect(view.getByTestId('weekly-summary-count-trend')).toHaveTextContent('↓ 20%');
    // Nothing the year has no earlier total of is judged.
    expect(view.queryByTestId('weekly-summary-duration-trend')).toBeNull();
    expect(engine.getTrainingScreenData).toHaveBeenCalledTimes(1);
  });
});
