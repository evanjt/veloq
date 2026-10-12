/**
 * Scenario: the weekly summary draws an arrow and a percentage beside each
 * total, and a screen reader read the arrow as "up arrow" whatever it meant.
 *
 * Expected behaviour: each trend is named with its judgement in words, and a
 * total with no judgement, such as load, with the direction it moved.
 */

import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { initialiseI18n } from '@/i18n';
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

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

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

describe('the weekly summary trends for a screen reader', () => {
  it('names each trend with its judgement and no arrow', async () => {
    jest
      .requireMock('@/features/fitness/hooks')
      .useAthleteSummary.mockReturnValue({ data: SUMMARY, isLoading: false });

    const view = await render(<WeeklySummary />, { wrapper });

    // Five activities against the engine's three, and 120 load against 90.
    await waitFor(() => expect(view.getByLabelText('improved, 67%')).toBeTruthy());
    expect(view.getByLabelText('rose, 33%')).toBeTruthy();
    expect(view.queryByLabelText(/[↑↓→]/)).toBeNull();
  });
});
