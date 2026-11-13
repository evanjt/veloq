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
import { RangeCoverage } from 'veloqrs';

import { initialiseI18n } from '@/i18n';
import { WeeklySummary } from '@/features/stats/components/WeeklySummary';
import { getEngine } from '@/shared/native/engine';
import { summaryComparison, fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

/** Five activities against three, and 120 load against 90, as the engine judged them. */
const engine = {
  getFitnessScreenData: fitnessScreenRead({
    comparisons: (now) => ({
      week: summaryComparison(now, {
        currentStats: { count: 5, totalDuration: 9000, totalDistance: 80000, totalTss: 120 },
        previousStats: { count: 3, totalDuration: 9000, totalDistance: 80000, totalTss: 90 },
        moves: {
          count: { glyph: '↑', percent: 67 },
          duration: { glyph: '→' },
          distance: { glyph: '→' },
          load: { glyph: '↑', percent: 33 },
        },
      }),
    }),
  }),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
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
    const view = await render(
      <WithScreenRead>{(training) => <WeeklySummary training={training} />}</WithScreenRead>,
      { wrapper }
    );

    await waitFor(() => expect(view.getByLabelText('improved, 67%')).toBeTruthy());
    expect(view.getByLabelText('rose, 33%')).toBeTruthy();
    expect(view.queryByLabelText(/[↑↓→]/)).toBeNull();
  });
});
