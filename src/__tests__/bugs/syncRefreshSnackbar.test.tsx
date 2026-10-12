import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable } from 'react-native';
import { StartOutcome } from 'veloqrs';

import { SyncRefreshNotice, useSyncRefreshNotice } from '@/shared/native/useSyncRefreshNotice';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';

jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));

const request = jest.mocked(requestSyncRefresh);

function PulledScreen() {
  const { notice, requestRefresh } = useSyncRefreshNotice();
  return (
    <>
      <Pressable testID="pull" onPress={requestRefresh} />
      <SyncRefreshNotice message={notice} />
    </>
  );
}

async function pull() {
  await fireEvent.press(screen.getByTestId('pull'));
}

async function renderScreen() {
  await render(<PulledScreen />);
}

async function advance(ms: number) {
  await act(() => jest.advanceTimersByTime(ms));
}

// The snackbar fades out over a further animation once its time is up.
async function finishHiding() {
  await advance(300);
}

describe('pull to refresh snackbar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it.each([
    [StartOutcome.Busy, 'refresh.busy'],
    [StartOutcome.Offline, 'refresh.offline'],
  ])('shows the refusal %s in the snackbar for three seconds', async (outcome, key) => {
    request.mockReturnValue(outcome);
    await renderScreen();

    await pull();
    await advance(2900);
    expect(screen.getByTestId('sync-refresh-snackbar')).toHaveTextContent(key);

    await advance(100);
    await finishHiding();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
    expect(screen.queryByText(key)).toBeNull();
  });

  it('restarts its time on a second pull rather than stacking', async () => {
    request.mockReturnValue(StartOutcome.Busy);
    await renderScreen();

    await pull();
    await advance(2000);
    await pull();
    await advance(2000);
    expect(screen.getAllByTestId('sync-refresh-snackbar')).toHaveLength(1);
    expect(screen.getAllByText('refresh.busy')).toHaveLength(1);

    await advance(1000);
    await finishHiding();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
  });

  it('shows nothing when the pull starts a sync', async () => {
    request.mockReturnValue(StartOutcome.Started);
    await renderScreen();

    await pull();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
  });
});
