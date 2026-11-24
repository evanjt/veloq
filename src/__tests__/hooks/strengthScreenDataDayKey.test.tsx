/**
 * Scenario: the strength tab is read on one day, left, and opened again after
 * midnight within the cache's lifetime.
 *
 * Expected behaviour: the second open reads the engine again over the new
 * window, rather than serving the previous day's period from the cache.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useStrengthScreenData } from '@/features/strength/hooks/useStrengthScreenData';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

const mockEngine: Record<string, unknown> = {};

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => true,
}));

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => mockEngine,
}));

const emptySummary = {
  muscleVolumes: [],
  activityCount: 0,
  totalSets: 0,
  maxWeightedSets: 0,
  balance: [],
};

describe('useStrengthScreenData across midnight', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the engine again when the day has changed', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'queueMicrotask',
        'nextTick',
      ],
    });
    const windows: number[] = [];
    Object.assign(mockEngine, {
      subscribe: () => () => undefined,
      getStrengthScreenData: (startTs: number) => {
        windows.push(startTs);
        return { summary: emptySummary, weekly: [], progressions: [], exercises: [], owedCount: 0 };
      },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    jest.setSystemTime(new Date(2026, 10, 3, 12, 0, 0));
    const first = await renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await waitFor(() => expect(first.result.current.data).toBeTruthy());
    first.unmount();

    jest.setSystemTime(new Date(2026, 10, 4, 12, 0, 0));
    const second = await renderHook(() => useStrengthScreenData('1m'), { wrapper });
    await waitFor(() => expect(second.result.current.data).toBeTruthy());

    expect(windows).toHaveLength(2);
    expect(windows[1]).toBeGreaterThan(windows[0]);
  });
});
