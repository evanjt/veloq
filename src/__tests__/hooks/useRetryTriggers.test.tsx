/**
 * Scenario: a transient network failure leaves the app with nothing to retry
 * on. These are the two edges that should wake it.
 *
 * Expected behaviour: the reconnect callback fires on the offline to online
 * edge only, and the foreground callback fires when the app returns to active
 * from anything else. Both read the network as a value, so an effect keyed on
 * them actually re-runs.
 */
import React from 'react';
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useForeground, useReconnect } from '@/shared/app/useRetryTriggers';

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline, isInternetReachable: null, connectionType: null }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

describe('useReconnect', () => {
  beforeEach(() => {
    mockIsOnline = true;
  });

  it('stays quiet while the connection never drops', () => {
    const onReconnect = jest.fn();
    const { rerender } = renderHook(() => useReconnect(onReconnect), { wrapper });

    rerender({});
    rerender({});

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('fires on the offline to online edge', () => {
    const onReconnect = jest.fn();
    const { rerender } = renderHook(() => useReconnect(onReconnect), { wrapper });

    mockIsOnline = false;
    act(() => rerender({}));
    expect(onReconnect).not.toHaveBeenCalled();

    mockIsOnline = true;
    act(() => rerender({}));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('does not fire again while the connection holds', () => {
    const onReconnect = jest.fn();
    const { rerender } = renderHook(() => useReconnect(onReconnect), { wrapper });

    mockIsOnline = false;
    act(() => rerender({}));
    mockIsOnline = true;
    act(() => rerender({}));
    act(() => rerender({}));
    act(() => rerender({}));

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('calls the latest callback, not the one captured at mount', () => {
    const first = jest.fn();
    const second = jest.fn();
    let callback = first;
    const { rerender } = renderHook(() => useReconnect(callback), { wrapper });

    callback = second;
    mockIsOnline = false;
    act(() => rerender({}));
    mockIsOnline = true;
    act(() => rerender({}));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('useForeground', () => {
  let listener: ((status: string) => void) | null = null;
  let remove: jest.Mock;

  beforeEach(() => {
    listener = null;
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      listener = handler as (status: string) => void;
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fires when the app returns to active from the background', () => {
    const onForeground = jest.fn();
    renderHook(() => useForeground(onForeground), { wrapper });

    act(() => listener?.('background'));
    act(() => listener?.('active'));

    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('ignores an inactive to active flicker with no background in between', () => {
    const onForeground = jest.fn();
    renderHook(() => useForeground(onForeground), { wrapper });

    act(() => listener?.('active'));

    expect(onForeground).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useForeground(jest.fn()), { wrapper });

    unmount();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
