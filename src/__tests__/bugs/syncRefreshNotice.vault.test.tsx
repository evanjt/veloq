import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Pressable } from 'react-native';
import { StartOutcome } from 'veloqrs';

import { useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { NoticeHost } from '@/shared/ui/Notice';

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));

const request = jest.mocked(requestSyncRefresh);

function PulledScreen() {
  const { requestRefresh } = useSyncRefreshNotice();
  return (
    <>
      <Pressable testID="pull" onPress={requestRefresh} />
      <NoticeHost />
    </>
  );
}

async function pull() {
  await fireEvent.press(screen.getByTestId('pull'));
}

// Past the notice's time and the fade that follows it.
async function runOut() {
  await act(() => jest.advanceTimersByTime(3000));
  await act(() => jest.advanceTimersByTime(300));
}

describe('pull to refresh notice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    [StartOutcome.Busy, 'refresh.busy'],
    [StartOutcome.Held, 'refresh.busy'],
    [StartOutcome.NotReady, 'refresh.notReady'],
    [StartOutcome.Offline, 'refresh.offline'],
    [StartOutcome.NotConfigured, 'refresh.notConfigured'],
    [StartOutcome.Failed, 'refresh.failed'],
  ])('shows and announces the refusal %s, then clears it', async (outcome, key) => {
    request.mockReturnValue(outcome);
    await render(<PulledScreen />);

    await pull();

    expect(screen.getByText(key)).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(key);
    await runOut();
    expect(screen.queryByText(key)).toBeNull();
  });

  it('clears an earlier refusal when the next pull starts', async () => {
    request.mockReturnValueOnce(StartOutcome.Offline).mockReturnValueOnce(StartOutcome.Started);
    await render(<PulledScreen />);

    await pull();
    expect(screen.getByText('refresh.offline')).toBeTruthy();
    await pull();
    await act(() => jest.advanceTimersByTime(300));
    expect(screen.queryByText('refresh.offline')).toBeNull();
  });
});
