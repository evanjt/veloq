/**
 * Scenario: a rider leaves the app mid-ride and the process stays alive. The
 * foreground service keeps delivering fixes into the live store, but React
 * Native pauses JS timers while the host is backgrounded, so the periodic
 * backup timer never fires.
 *
 * Expected behaviour: the backup is written on the way out, and each batch
 * that arrives while the app is not in front persists the ride once an
 * interval has passed since the last write, by the fixes' own timestamps.
 */

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  loadRecordingBackup: jest.fn(async () => null),
  saveRecordingBackup: jest.fn(async () => true),
}));

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  locationServiceRunning: jest.fn(async () => true),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => true),
}));

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Each test resets the module registry, so the runtime's own `AppState` is the
// one the code under test reads.
let AppState: typeof import('react-native').AppState;

function setAppState(state: string): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

function liveRuntime() {
  jest.resetModules();
  AppState = require('react-native').AppState;
  const { useRecordingStore } = require('@/features/recording/stores/RecordingStore');
  const { useAuthStore } = require('@/shared/app/AuthStore');
  const { handleBackgroundLocations } = require('@/features/recording/lib/backgroundLocation');
  const { saveRecordingBackup } = require('@/features/recording/lib/storage/recordingBackup') as {
    saveRecordingBackup: jest.Mock;
  };
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true, isLoading: false });
  useRecordingStore.getState().startRecording('Ride', 'gps');
  const startTime: number = useRecordingStore.getState().startTime;
  const fixesAt = (...seconds: number[]) =>
    seconds.map((second) => ({
      coords: {
        latitude: 47.5 + (second * 5) / 111_320,
        longitude: 8.5,
        altitude: 400,
        accuracy: 5,
        speed: 5,
        heading: null,
      },
      timestamp: startTime + second * 1000,
    }));
  return { useRecordingStore, handleBackgroundLocations, saveRecordingBackup, fixesAt };
}

describe('the crash backup of a backgrounded ride', () => {
  afterEach(() => {
    setAppState('active');
    jest.restoreAllMocks();
  });

  it('persists a batch that reaches a live store while the app is in the background', async () => {
    const rt = liveRuntime();
    setAppState('background');

    await rt.handleBackgroundLocations(rt.fixesAt(20, 21, 22));

    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(1);
    expect(rt.saveRecordingBackup.mock.calls[0][0].streams.time).toEqual([20, 21, 22]);
  });

  it('leaves the write to the foreground timer while the app is in front', async () => {
    const rt = liveRuntime();
    setAppState('active');

    await rt.handleBackgroundLocations(rt.fixesAt(20));

    expect(rt.saveRecordingBackup).not.toHaveBeenCalled();
  });

  it('writes at most once an interval, measured by the fixes', async () => {
    const rt = liveRuntime();
    setAppState('background');

    await rt.handleBackgroundLocations(rt.fixesAt(20));
    await rt.handleBackgroundLocations(rt.fixesAt(21));
    await rt.handleBackgroundLocations(rt.fixesAt(34));
    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(1);

    await rt.handleBackgroundLocations(rt.fixesAt(35));
    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(2);
    expect(rt.saveRecordingBackup.mock.calls[1][0].streams.time).toEqual([20, 21, 34, 35]);
  });

  it('writes the ride on the way out of the foreground', async () => {
    const rt = liveRuntime();
    rt.useRecordingStore.getState().reset();
    let listener: ((state: string) => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      next: (state: string) => void
    ) => {
      listener = next;
      return { remove: jest.fn() };
    }) as never);
    setAppState('active');
    const { installRecordingSession } = require('@/features/recording/lib/recordingSession');
    const uninstall = installRecordingSession();
    rt.useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    rt.useRecordingStore.getState().addGpsPoint({
      latitude: 47.5,
      longitude: 8.5,
      altitude: 400,
      accuracy: 5,
      speed: 5,
      heading: null,
      timestamp: rt.useRecordingStore.getState().startTime + 5_000,
    });
    rt.saveRecordingBackup.mockClear();

    setAppState('background');
    listener!('background');
    await settle();

    expect(rt.saveRecordingBackup).toHaveBeenCalledTimes(1);
    expect(rt.saveRecordingBackup.mock.calls[0][0].streams.time).toEqual([5]);
    uninstall();
  });
});
