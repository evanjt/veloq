/**
 * Scenario: pull-to-refresh on the Fitness screen, with the wellness refetch
 * rejecting because the device is offline.
 *
 * Expected behaviour: the spinner stops. Without a `finally` the rejection
 * skips the reset and the control spins for the rest of the session, with no
 * way back short of leaving the screen. The pull, through the shared control,
 * fires its haptic before the refetch starts.
 */

import { renderHook, render, screen, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RefreshControl } from 'react-native';

import * as ExpoHaptics from 'expo-haptics';

import { useFitnessRefresh } from '@/features/fitness/hooks/useFitnessRefresh';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { queryKeys } from '@/shared/query/queryKeys';

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

const impact = ExpoHaptics.impactAsync as jest.Mock;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  impact.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('pull to refresh on the Fitness screen', () => {
  it('clears the spinner when the wellness refetch rejects', async () => {
    const refetch = jest.fn().mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useFitnessRefresh(refetch), { wrapper });

    await act(async () => {
      await result.current.onRefresh().catch(() => {});
    });

    await waitFor(() => expect(result.current.isRefreshing).toBe(false));
  });

  it('invalidates the engine stats behind the calendar, the week and the year comparison', async () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const refetch = jest.fn().mockResolvedValue(undefined);
    const { result } = await renderHook(() => useFitnessRefresh(refetch), { wrapper });

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.stats.all });
  });

  it('clears the spinner on a refresh that resolves', async () => {
    const refetch = jest.fn().mockResolvedValue(undefined);
    const { result } = await renderHook(() => useFitnessRefresh(refetch), { wrapper });

    await act(async () => {
      await result.current.onRefresh();
    });

    expect(result.current.isRefreshing).toBe(false);
  });

  it('fires a medium impact before the refetch, once per pull', async () => {
    const order: string[] = [];
    impact.mockImplementation(() => {
      order.push('haptic');
      return Promise.resolve();
    });
    const refetch = jest.fn(() => {
      order.push('refetch');
      return Promise.resolve();
    });
    const { result } = await renderHook(() => useFitnessRefresh(refetch), { wrapper });
    await render(
      React.createElement(ScreenRefreshControl, {
        refreshing: result.current.isRefreshing,
        onRefresh: result.current.onRefresh,
      })
    );
    const control = screen.UNSAFE_getByType(RefreshControl);

    await act(async () => {
      await control.props.onRefresh();
    });
    expect(order).toEqual(['haptic', 'refetch']);
    expect(impact).toHaveBeenCalledWith('medium');

    await act(async () => {
      await control.props.onRefresh();
    });
    expect(impact).toHaveBeenCalledTimes(2);
  });
});
