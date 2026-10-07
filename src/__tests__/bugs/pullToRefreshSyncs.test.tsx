/**
 * Scenario: the athlete pulls down on the fitness screen. The gesture only
 * invalidated queries that read SQLite, so it redrew what the last sync wrote
 * and never reached intervals.icu.
 *
 * Expected behaviour: the refresh handler asks the engine for a sync as well,
 * and the spinner comes back down when the wellness refetch rejects.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useFitnessRefresh } from '@/features/fitness/hooks/useFitnessRefresh';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('fitness pull-to-refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks the engine for a sync and refetches wellness', async () => {
    const refetchWellness = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFitnessRefresh(refetchWellness), { wrapper });

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
    expect(refetchWellness).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(false);
  });

  it('stops the spinner when the wellness refetch rejects', async () => {
    const refetchWellness = jest.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFitnessRefresh(refetchWellness), { wrapper });

    await act(async () => {
      await result.current.onRefresh().catch(() => undefined);
    });

    expect(requestSyncRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(false);
  });
});
