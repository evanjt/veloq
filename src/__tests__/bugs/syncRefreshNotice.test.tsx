import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { StartOutcome } from 'veloqrs';

import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));

const request = jest.mocked(requestSyncRefresh);

describe('pull to refresh notice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    [StartOutcome.Busy, 'refresh.busy'],
    [StartOutcome.Held, 'refresh.busy'],
    [StartOutcome.NotReady, 'refresh.notReady'],
    [StartOutcome.Offline, 'refresh.offline'],
    [StartOutcome.NotConfigured, 'refresh.notConfigured'],
    [StartOutcome.Failed, 'refresh.failed'],
  ])('shows and announces the refusal %s, then clears it', async (outcome, key) => {
    request.mockReturnValue(outcome);
    const { result } = await renderHook(() => useSyncRefreshNotice());

    await act(() => result.current.requestRefresh());

    expect(result.current.notice).toBe(key);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(key);
    await act(() => jest.runOnlyPendingTimers());
    expect(result.current.notice).toBeNull();
  });

  it('clears an earlier refusal when the next pull starts', async () => {
    request.mockReturnValueOnce(StartOutcome.Offline).mockReturnValueOnce(StartOutcome.Started);
    const { result } = await renderHook(() => useSyncRefreshNotice());

    await act(() => result.current.requestRefresh());
    expect(result.current.notice).toBe('refresh.offline');
    await act(() => result.current.requestRefresh());
    expect(result.current.notice).toBeNull();
  });
});
