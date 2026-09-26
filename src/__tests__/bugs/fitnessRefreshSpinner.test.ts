/**
 * Scenario: pull-to-refresh on the Fitness screen, with the wellness refetch
 * rejecting because the device is offline.
 *
 * Expected behaviour: the spinner stops. Without a `finally` the rejection
 * skips the reset and the control spins for the rest of the session, with no
 * way back short of leaving the screen.
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useFitnessRefresh } from '@/features/fitness/hooks/useFitnessRefresh';

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('pull to refresh on the Fitness screen', () => {
  it('clears the spinner when the wellness refetch rejects', async () => {
    const refetch = jest.fn().mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFitnessRefresh(refetch), { wrapper });

    await act(async () => {
      await result.current.onRefresh().catch(() => {});
    });

    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it('clears the spinner on a refresh that resolves', async () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFitnessRefresh(refetch), { wrapper });

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(result.current.isRefreshing).toBe(false);
  });
});
