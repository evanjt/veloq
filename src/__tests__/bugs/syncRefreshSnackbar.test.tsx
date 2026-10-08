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

function pull() {
  fireEvent.press(screen.getByTestId('pull'));
}

function renderScreen() {
  render(<PulledScreen />);
}

function advance(ms: number) {
  act(() => jest.advanceTimersByTime(ms));
}

// The snackbar fades out over a further animation once its time is up.
function finishHiding() {
  advance(300);
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
  ])('shows the refusal %s in the snackbar for three seconds', (outcome, key) => {
    request.mockReturnValue(outcome);
    renderScreen();

    pull();
    advance(2900);
    expect(screen.getByTestId('sync-refresh-snackbar')).toHaveTextContent(key);

    advance(100);
    finishHiding();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
    expect(screen.queryByText(key)).toBeNull();
  });

  it('restarts its time on a second pull rather than stacking', () => {
    request.mockReturnValue(StartOutcome.Busy);
    renderScreen();

    pull();
    advance(2000);
    pull();
    advance(2000);
    expect(screen.getAllByTestId('sync-refresh-snackbar')).toHaveLength(1);
    expect(screen.getAllByText('refresh.busy')).toHaveLength(1);

    advance(1000);
    finishHiding();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
  });

  it('shows nothing when the pull starts a sync', () => {
    request.mockReturnValue(StartOutcome.Started);
    renderScreen();

    pull();
    expect(screen.queryByTestId('sync-refresh-snackbar')).toBeNull();
  });
});
