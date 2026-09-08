/**
 * Scenario: the Live Activity is owned by the recording session, not the screen.
 * Expected behaviour: a card for every live session, ended when the session ends,
 * refreshed on its own tick, and orphans reaped before the first session starts.
 */

import * as controller from '@/features/recording/lib/liveActivity/controller';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { LIVE_ACTIVITY_REFRESH_MS } from '@/features/recording/lib/constants';
jest.mock('@/features/recording/lib/liveActivity/controller', () => ({
  beginLiveActivity: jest.fn(),
  refreshLiveActivity: jest.fn(),
  finishLiveActivity: jest.fn(),
  reapOrphanedLiveActivities: jest.fn(),
  installLiveActivityControls: jest.fn(() => jest.fn()),
}));
jest.mock('@/features/recording/lib/backgroundLocation', () => ({
  startBackgroundLocation: jest.fn(async () => undefined),
  stopBackgroundLocation: jest.fn(async () => undefined),
}));
jest.mock('expo-location', () => ({
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  Accuracy: { BestForNavigation: 6 },
}));

describe('recording session drives the live activity', () => {
  let uninstall: () => void;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    jest.useRealTimers();
  });

  it('reaps an orphaned card before any session can start a new one', () => {
    expect(jest.mocked(controller).reapOrphanedLiveActivities).toHaveBeenCalledTimes(1);
  });

  it('listens for the card controls for as long as the session is installed', () => {
    expect(jest.mocked(controller).installLiveActivityControls).toHaveBeenCalledTimes(1);
    const stopListening = jest.mocked(controller).installLiveActivityControls.mock.results[0].value;

    uninstall();
    uninstall = () => undefined;

    expect(stopListening).toHaveBeenCalledTimes(1);
  });

  it('begins a card when the recording starts and ends it when it stops', () => {
    useRecordingStore.getState().startRecording('Ride', 'indoor');
    expect(jest.mocked(controller).beginLiveActivity).toHaveBeenCalledTimes(1);

    useRecordingStore.getState().stopRecording();
    expect(jest.mocked(controller).finishLiveActivity).toHaveBeenCalledTimes(1);
  });

  it('refreshes the card on its own tick, not on every GPS fix', () => {
    useRecordingStore.getState().startRecording('Ride', 'indoor');
    jest.mocked(controller).refreshLiveActivity.mockClear();

    jest.advanceTimersByTime(LIVE_ACTIVITY_REFRESH_MS * 3);

    expect(jest.mocked(controller).refreshLiveActivity).toHaveBeenCalledTimes(3);
  });

  it('refreshes at once on a pause, so the card does not wait out a tick', () => {
    useRecordingStore.getState().startRecording('Ride', 'indoor');
    jest.mocked(controller).refreshLiveActivity.mockClear();

    useRecordingStore.getState().pauseRecording();

    expect(jest.mocked(controller).refreshLiveActivity).toHaveBeenCalled();
  });

  it('stops ticking once the session ends', () => {
    useRecordingStore.getState().startRecording('Ride', 'indoor');
    useRecordingStore.getState().stopRecording();
    jest.mocked(controller).refreshLiveActivity.mockClear();

    jest.advanceTimersByTime(LIVE_ACTIVITY_REFRESH_MS * 5);

    expect(jest.mocked(controller).refreshLiveActivity).not.toHaveBeenCalled();
  });
});
