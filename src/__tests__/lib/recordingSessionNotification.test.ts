/**
 * Scenario: the rider leaves the app while a GPS recording runs, and every fix
 * from then on arrives in the background.
 *
 * Expected behaviour: the session owns the notification the way it owns the
 * watch and the backups. It installs the buttons when the ride starts, redraws
 * on a pause, a lap and each background batch, and lets it go when the ride
 * ends.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { handleBackgroundLocations } from '@/features/recording/lib/backgroundLocation';
import {
  clearRecordingNotification,
  installRecordingNotificationActions,
  updateRecordingNotification,
} from '@/features/recording/lib/recordingNotification';

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => ({ startTime: 1 })),
  saveRecordingBackup: jest.fn(),
  loadRecordingBackup: jest.fn(async () => null),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

function fix(secondsIn: number) {
  return {
    coords: {
      latitude: 47.5 + secondsIn / 111_320,
      longitude: 8.5,
      altitude: 400,
      accuracy: 5,
      speed: null,
      heading: null,
    },
    timestamp: Date.now() + secondsIn * 1000,
  };
}

describe('the recording session and its notification', () => {
  let uninstall: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    useRecordingStore.getState().reset();
  });

  it('installs the buttons when the ride starts', () => {
    expect(installRecordingNotificationActions).not.toHaveBeenCalled();
    useRecordingStore.getState().startRecording('Ride', 'gps');
    expect(installRecordingNotificationActions).toHaveBeenCalledTimes(1);
  });

  it('redraws on a pause and on a resume', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    (updateRecordingNotification as jest.Mock).mockClear();
    useRecordingStore.getState().pauseRecording();
    expect(updateRecordingNotification).toHaveBeenCalledTimes(1);
    useRecordingStore.getState().resumeRecording();
    expect(updateRecordingNotification).toHaveBeenCalledTimes(2);
  });

  it('redraws on a lap', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().addGpsPoint({ ...fix(1).coords, timestamp: fix(1).timestamp });
    (updateRecordingNotification as jest.Mock).mockClear();
    useRecordingStore.getState().addLap();
    expect(updateRecordingNotification).toHaveBeenCalledTimes(1);
  });

  it('redraws on a background batch, which is all that happens out there', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    (updateRecordingNotification as jest.Mock).mockClear();
    await handleBackgroundLocations([fix(1), fix(2)] as never);
    expect(updateRecordingNotification).toHaveBeenCalledTimes(1);
  });

  it('draws nothing for a batch that arrives with no session', async () => {
    await handleBackgroundLocations([fix(1)] as never);
    expect(updateRecordingNotification).not.toHaveBeenCalled();
  });

  it('lets the notification go when the ride ends', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    expect(clearRecordingNotification).not.toHaveBeenCalled();
    useRecordingStore.getState().stopRecording();
    expect(clearRecordingNotification).toHaveBeenCalledTimes(1);
  });
});
