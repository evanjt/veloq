/**
 * Scenario: the strength screen is read while its FIT files are still
 * downloading, so the first read is empty. The files then land and the engine
 * announces `fitParsed`.
 *
 * Expected behaviour: the screen read is fetched again and returns the parsed
 * sets, rather than keeping the empty summary.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useStrengthScreenData } from '@/features/strength/hooks/useStrengthScreenData';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockEngine: Record<string, unknown> = {};
const listeners = new Map<string, (payload?: unknown) => void>();

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockEngine,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

function screenData(activityCount: number) {
  return {
    summary: { muscleVolumes: [], activityCount, totalSets: activityCount * 4, balance: [] },
    weekly: [],
    progressions: [],
    exercises: [],
    owedCount: 0,
  };
}

describe('useStrengthScreenData on fitParsed', () => {
  it('re-reads the screen once a parse lands after an empty first read', async () => {
    let reads = 0;
    Object.assign(mockEngine, {
      subscribe: (event: string, callback: (payload?: unknown) => void) => {
        listeners.set(event, callback);
        return () => listeners.delete(event);
      },
      getStrengthScreenData: () => {
        reads += 1;
        return screenData(reads === 1 ? 0 : 3);
      },
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useStrengthScreenData('1m'), { wrapper });

    await waitFor(() => expect(result.current.data?.summary.activityCount).toBe(0));
    expect(listeners.has('fitParsed')).toBe(true);

    act(() => listeners.get('fitParsed')?.());

    await waitFor(() => expect(result.current.data?.summary.activityCount).toBe(3));
    expect(reads).toBe(2);
  });
});
