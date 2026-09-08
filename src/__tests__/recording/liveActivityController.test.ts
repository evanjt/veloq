/**
 * Scenario: the recording session drives a Live Activity on iOS.
 * Expected behaviour: one card per session, ended on stop, and any card that
 * outlived a terminated app reaped at launch.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  beginLiveActivity,
  finishLiveActivity,
  installLiveActivityControls,
  reapOrphanedLiveActivities,
  refreshLiveActivity,
} from '@/features/recording/lib/liveActivity/controller';
const mockControlListeners: ((event: { action: string }) => void)[] = [];

const mockNative = {
  emit: (action: string) => {
    for (const listener of [...mockControlListeners]) listener({ action });
  },
  addListener: jest.fn((_event: string, listener: (event: { action: string }) => void) => {
    mockControlListeners.push(listener);
    return {
      remove: () => {
        const at = mockControlListeners.indexOf(listener);
        if (at >= 0) mockControlListeners.splice(at, 1);
      },
    };
  }),
  isSupported: jest.fn(() => true),
  start: jest.fn(() => 'activity-1'),
  update: jest.fn(),
  end: jest.fn(),
  endAll: jest.fn(),
};

// Only the one lookup is replaced, so `requireNativeModule` survives for
// expo's lazy `fetch` global. See memoryPressure.test.ts.
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(() => mockNative),
}));

function startRide(): void {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.setState({ startTime: Date.now() - 300_000 });
}

describe('live activity controller', () => {
  beforeEach(() => {
    finishLiveActivity();
    jest.clearAllMocks();
    mockNative.isSupported.mockReturnValue(true);
    mockNative.start.mockReturnValue('activity-1');
    useRecordingStore.getState().reset();
  });

  it('starts one card for the session and ignores a second begin', () => {
    startRide();
    beginLiveActivity();
    beginLiveActivity();

    expect(mockNative.start).toHaveBeenCalledTimes(1);
    const [attributes, state] = mockNative.start.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(attributes).activityType).toBe('Ride');
    expect(JSON.parse(state).status).toBe('recording');
  });

  it('does nothing at all when the platform has no Live Activities', () => {
    mockNative.isSupported.mockReturnValue(false);
    startRide();
    beginLiveActivity();
    refreshLiveActivity();

    expect(mockNative.start).not.toHaveBeenCalled();
    expect(mockNative.update).not.toHaveBeenCalled();
  });

  it('pushes the paused status through, so the card stops counting', () => {
    startRide();
    beginLiveActivity();
    useRecordingStore.getState().pauseRecording();
    refreshLiveActivity();

    const state = JSON.parse(mockNative.update.mock.calls.at(-1)![0] as string);
    expect(state.status).toBe('paused');
    expect(state.frozenElapsedS).toBeGreaterThan(0);
  });

  it('refuses to update once the card is finished', () => {
    startRide();
    beginLiveActivity();
    finishLiveActivity();
    refreshLiveActivity();

    expect(mockNative.end).toHaveBeenCalledTimes(1);
    expect(mockNative.update).not.toHaveBeenCalled();
  });

  it('ends nothing when no card was ever started', () => {
    finishLiveActivity();

    expect(mockNative.end).not.toHaveBeenCalled();
  });

  it('reaps a card the app was terminated under, because nothing else will', () => {
    reapOrphanedLiveActivities();

    expect(mockNative.endAll).toHaveBeenCalledTimes(1);
  });

  it('survives a native module that throws, rather than taking the recording down', () => {
    mockNative.start.mockImplementation(() => {
      throw new Error('ActivityKit refused');
    });
    startRide();

    expect(() => beginLiveActivity()).not.toThrow();
    expect(() => refreshLiveActivity()).not.toThrow();
  });
});

describe('live activity controls', () => {
  beforeEach(() => {
    finishLiveActivity();
    jest.clearAllMocks();
    mockControlListeners.length = 0;
    mockNative.isSupported.mockReturnValue(true);
    useRecordingStore.getState().reset();
  });

  it('pauses the ride when the card asks, so one path owns the pause', () => {
    startRide();
    installLiveActivityControls();
    mockNative.emit('pause');

    expect(useRecordingStore.getState().status).toBe('paused');
  });

  it('resumes from the card, and a toggle reads the store rather than the button', () => {
    startRide();
    installLiveActivityControls();
    mockNative.emit('pause');
    mockNative.emit('toggle');

    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('ignores a control that arrives when nothing is recording', () => {
    installLiveActivityControls();
    mockNative.emit('pause');

    expect(useRecordingStore.getState().status).toBe('idle');
  });

  it('stops listening once uninstalled', () => {
    const uninstall = installLiveActivityControls();
    uninstall();
    startRide();
    mockNative.emit('pause');

    expect(useRecordingStore.getState().status).toBe('recording');
  });
});
