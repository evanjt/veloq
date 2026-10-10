/**
 * Scenario: Android kills the app mid-ride, the next location batch restores
 * the ride in a headless runtime, and that batch re-posts the notification with
 * its buttons. The native receiver hands a press to any runtime that has the
 * module loaded, and queues it only when none has.
 *
 * Expected behaviour: the runtime that restored the ride listens for the
 * buttons, so a press reaches the store. A session that starts later in the
 * same runtime shares that one listener, so a press is applied once.
 */

import type { RecordingBackup } from '@/features/recording/types';

const mockListeners: ((payload: { action: string; session?: number }) => void)[] = [];
const mockNative = {
  update: jest.fn(),
  clear: jest.fn(),
  clearInterrupted: jest.fn(),
  drainPendingActions: jest.fn((): string[] => []),
  serviceRunning: jest.fn(() => true),
  addListener: jest.fn(
    (_event: string, listener: (payload: { action: string; session?: number }) => void) => {
      mockListeners.push(listener);
      return {
        remove: jest.fn(() => {
          const index = mockListeners.indexOf(listener);
          if (index >= 0) mockListeners.splice(index, 1);
        }),
      };
    }
  ),
};

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  loadRecordingBackup: jest.fn(),
  saveRecordingBackup: jest.fn(),
}));

// A headless stop has no screen to navigate to.
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

const START_TIME = 1_700_000_000_000;

// Each test is its own JS runtime, the way a headless wake-up is, so the
// listener one test installed is not there to answer the next.
function freshRuntime() {
  jest.resetModules();
  mockListeners.length = 0;
  // Spied on rather than mocked, so every other native module keeps the
  // preset's mock.
  const core = require('expo-modules-core');
  const preset = core.requireOptionalNativeModule;
  jest
    .spyOn(core, 'requireOptionalNativeModule')
    .mockImplementation((name: unknown) =>
      name === 'VeloqRecordingNotification' ? mockNative : preset(name)
    );
  const { useRecordingStore } = require('@/features/recording/stores/RecordingStore');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const { handleBackgroundLocations } = require('@/features/recording/lib/backgroundLocation');
  const { installRecordingSession } = require('@/features/recording/lib/recordingSession');
  const { loadRecordingBackup } = require('@/features/recording/lib/storage/recordingBackup') as {
    loadRecordingBackup: jest.Mock;
  };
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, isLoading: false });
  return {
    useRecordingStore,
    handleBackgroundLocations,
    installRecordingSession,
    loadRecordingBackup,
  };
}

function recordingBackup(): RecordingBackup {
  return {
    athleteId: 'i1',
    activityType: 'Ride',
    mode: 'gps',
    status: 'recording',
    startTime: START_TIME,
    stopTime: null,
    pausedDuration: 0,
    pauseIntervals: [],
    streams: {
      time: [0],
      latlng: [[47.5, 8.5]],
      altitude: [400],
      heartrate: [0],
      power: [0],
      cadence: [0],
      speed: [0],
      distance: [0],
    },
    laps: [],
    pairedEventId: null,
    savedAt: START_TIME + 60_000,
  };
}

function fixAt(seconds: number) {
  return {
    coords: {
      latitude: 47.5 + seconds / 111_320,
      longitude: 8.5,
      altitude: 400,
      accuracy: 5,
      speed: null,
      heading: null,
    },
    timestamp: START_TIME + seconds * 1000,
  };
}

async function press(action: string, session = START_TIME): Promise<void> {
  for (const listener of [...mockListeners]) listener({ action, session });
  // Stop persists before it settles, so let its promise chain run out.
  await new Promise((resolve) => setImmediate(resolve));
}

describe('notification buttons after a headless restore', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNative.drainPendingActions.mockReset();
    mockNative.drainPendingActions.mockReturnValue([]);
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it('applies a Stop pressed after the batch that restored the ride', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(recordingBackup());

    await rt.handleBackgroundLocations([fixAt(70)]);
    expect(rt.useRecordingStore.getState().status).toBe('recording');

    await press('stop');

    expect(rt.useRecordingStore.getState().status).toBe('stopped');
    expect(mockNative.clear).toHaveBeenCalled();
  });

  it('drains a press queued while no runtime listened, once', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(recordingBackup());
    mockNative.drainPendingActions.mockReturnValueOnce([`${START_TIME}\tpause`]);

    await rt.handleBackgroundLocations([fixAt(70)]);
    await rt.handleBackgroundLocations([fixAt(80)]);

    expect(rt.useRecordingStore.getState().status).toBe('paused');
    expect(mockNative.drainPendingActions).toHaveBeenCalledTimes(1);
  });

  it('ignores a press for another ride', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(recordingBackup());

    await rt.handleBackgroundLocations([fixAt(70)]);
    await press('stop', START_TIME - 1);

    expect(rt.useRecordingStore.getState().status).toBe('recording');
  });

  it('listens for no buttons when there is no ride to restore', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(null);

    await rt.handleBackgroundLocations([fixAt(70)]);

    expect(mockListeners).toHaveLength(0);
  });

  it('applies a Lap once when a session starts in the same runtime', async () => {
    const rt = freshRuntime();
    rt.loadRecordingBackup.mockResolvedValue(recordingBackup());

    await rt.handleBackgroundLocations([fixAt(70)]);
    uninstall = rt.installRecordingSession();
    expect(mockListeners).toHaveLength(1);

    await press('lap');
    expect(rt.useRecordingStore.getState().laps).toHaveLength(1);

    // The session ending gives back its own hold, not the restore's.
    uninstall?.();
    uninstall = null;
    expect(mockListeners).toHaveLength(1);
  });
});
