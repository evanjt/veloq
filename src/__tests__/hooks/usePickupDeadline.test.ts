import { act, renderHook } from '@testing-library/react-native';

import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { IDLE_EXTENDED_FETCH, PICKUP_DEADLINE_MS } from '@/shared/app/extendedFetch';
import { usePickupDeadline } from '@/shared/app/usePickupDeadline';

describe('pickup deadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    useSyncDateRange.setState({ extendedFetch: IDLE_EXTENDED_FETCH });
  });

  afterEach(() => jest.useRealTimers());

  it('expires thirty seconds after acceptance between interval ticks', () => {
    renderHook(() => usePickupDeadline());
    act(() => jest.advanceTimersByTime(35_000));
    act(() => useSyncDateRange.getState().windowAccepted());

    act(() => jest.advanceTimersByTime(PICKUP_DEADLINE_MS - 1));
    expect(useSyncDateRange.getState().extendedFetch.phase).toBe('awaitingPickup');
    act(() => jest.advanceTimersByTime(1));
    expect(useSyncDateRange.getState().extendedFetch.phase).toBe('expired');
  });

  it('restarts the deadline for a second accepted window', () => {
    renderHook(() => usePickupDeadline());
    act(() => useSyncDateRange.getState().windowAccepted());
    act(() => jest.advanceTimersByTime(20_000));
    act(() => useSyncDateRange.getState().windowAccepted());

    act(() => jest.advanceTimersByTime(10_000));
    expect(useSyncDateRange.getState().extendedFetch.phase).toBe('awaitingPickup');
    act(() => jest.advanceTimersByTime(20_000));
    expect(useSyncDateRange.getState().extendedFetch.phase).toBe('expired');
  });
});
