/**
 * Scenario: the fitness screen read throws, so the calendar has no days to draw.
 *
 * Expected behaviour: the calendar says the read failed and offers Retry, as the
 * weekly card does, rather than telling the athlete to complete activities. A
 * retry that succeeds draws the grid.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RangeCoverage } from 'veloqrs';

import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { changeLanguage, initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/native/engine', () => {
  const getEngine = jest.fn();
  return { getEngine, isEngineReady: () => getEngine() != null };
});
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const today = new Date().toISOString().slice(0, 10);
const okRead = fitnessScreenRead({
  heatmap: () => [{ date: today, intensity: 3, maxDuration: 6000, activityCount: 1 }],
});

let failing = true;
const engine = {
  subscribe: () => () => {},
  getFitnessScreenData: jest.fn((...args: unknown[]) => {
    if (failing) throw new Error('engine read failed');
    return (okRead as (...a: unknown[]) => unknown)(...args);
  }),
  getFeedCards: jest.fn(() => []),
  rangeCoverage: jest.fn(() => RangeCoverage.Loaded),
};

beforeAll(async () => {
  await initialiseI18n();
  await changeLanguage('en-AU');
});

beforeEach(() => {
  failing = true;
  (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue(
    engine as unknown as ReturnType<typeof getEngine>
  );
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WithScreenRead>{(training) => <ActivityHeatmap training={training} />}</WithScreenRead>
    </QueryClientProvider>
  );
}

describe('ActivityHeatmap read failure', () => {
  it('shows the failure and Retry, not the empty prompt', async () => {
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('activity-heatmap-failed')).toBeTruthy());
    expect(view.queryByText(/complete/i)).toBeNull();
  });

  it('draws the grid after Retry succeeds', async () => {
    const view = await mount();
    await waitFor(() => expect(view.getByTestId('activity-heatmap-failed')).toBeTruthy());
    failing = false;
    fireEvent.press(view.getByText(/retry/i));
    await waitFor(() => expect(view.getByTestId('activity-heatmap-count')).toBeTruthy());
  });
});
