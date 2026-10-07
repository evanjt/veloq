/**
 * Scenario: the engine throws while the Training tab's weekly summary reads
 * its totals.
 *
 * Expected behaviour: the card shows the engine failure line and a Retry in
 * place of "no activities in this period", and Retry reads again.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/features/fitness/hooks', () => ({
  ...jest.requireActual('@/features/fitness/hooks'),
  useAthleteSummary: jest.fn(() => ({ data: undefined, isLoading: false })),
}));

const engine = {
  getPeriodStats: jest.fn(() => {
    throw { tag: 'Database', inner: { msg: 'disk' } };
  }),
  rangeCoverage: jest.fn(() => 0),
  subscribe: jest.fn(() => () => {}),
};

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (getEngine as jest.Mock).mockReturnValue(engine);
});

it('shows the failure line and Retry, not the empty state, for a thrown read', async () => {
  const view = render(<WeeklySummary />, { wrapper });
  fireEvent.press(view.getByTestId('weekly-summary-range-month'));

  await waitFor(() => expect(view.getByTestId('weekly-summary-failed')).toBeTruthy());
  expect(view.getByText('engine.failure.database')).toBeTruthy();
  expect(view.queryByTestId('weekly-summary-empty')).toBeNull();

  const calls = engine.getPeriodStats.mock.calls.length;
  fireEvent.press(view.getByText('common.retry'));
  await waitFor(() => expect(engine.getPeriodStats.mock.calls.length).toBeGreaterThan(calls));
});
