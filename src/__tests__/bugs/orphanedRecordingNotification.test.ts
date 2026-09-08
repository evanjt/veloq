/**
 * Scenario: a ride ends abnormally. The app is force-stopped, or crashes, or is
 * reinstalled over. `stopSession` never runs, so nothing lets the recording
 * notification go, and `manager.notify` handed ownership of it to the app
 * rather than to the service, so neither the service dying nor the process
 * dying takes it down.
 *
 * Expected behaviour: the next launch reaps it, the way the iOS Live Activity
 * is reaped. A restored ride that is still live keeps its notification and
 * re-adopts it instead.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import {
  clearRecordingNotification,
  installRecordingNotificationActions,
} from '@/features/recording/lib/recordingNotification';

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  updateRecordingNotification: jest.fn(),
  clearRecordingNotification: jest.fn(),
  locationServiceRunning: jest.fn(() => true),
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
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
  stopLocationUpdatesAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

describe('a recording notification with no ride behind it', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    useRecordingStore.getState().reset();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    useRecordingStore.getState().reset();
  });

  it('is cancelled on the next launch', () => {
    uninstall = installRecordingSession();
    expect(clearRecordingNotification).toHaveBeenCalledTimes(1);
  });

  it('is kept and re-adopted when the restored ride is still live', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    jest.clearAllMocks();

    uninstall = installRecordingSession();

    expect(clearRecordingNotification).not.toHaveBeenCalled();
    expect(installRecordingNotificationActions).toHaveBeenCalledTimes(1);
  });

  it('is kept when the restored ride is paused', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().pauseRecording();
    jest.clearAllMocks();

    uninstall = installRecordingSession();

    expect(clearRecordingNotification).not.toHaveBeenCalled();
  });

  it('reaps once per install, not on every status change afterwards', () => {
    uninstall = installRecordingSession();
    jest.clearAllMocks();

    useRecordingStore.getState().startRecording('Ride', 'gps');
    useRecordingStore.getState().stopRecording();

    // The ordinary end of a ride still clears, exactly once, through
    // `stopSession`. The reap does not add a second one.
    expect(clearRecordingNotification).toHaveBeenCalledTimes(1);
  });
});

describe('the native clear cancels the notification rather than only a retry', () => {
  const fs = require('fs');
  const path = require('path');
  const KOTLIN = fs.readFileSync(
    path.join(
      __dirname,
      '../../../modules/veloq-recording-notification/android/src/main/java/com/veloq/recording/VeloqRecordingNotificationModule.kt'
    ),
    'utf8'
  );

  function body(signature: string): string {
    const start = KOTLIN.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return KOTLIN.slice(start, KOTLIN.indexOf('\n  }\n', start));
  }

  it('cancels the notification and not only the pending retry', () => {
    const clear = body('Function("clear")');
    expect(clear).toContain('cancelRetry()');
    expect(clear).toContain('cancelNotification()');
  });

  it('cancels only the notification it finds on the recording channel', () => {
    const cancel = body('private fun cancelNotification');
    expect(cancel).toContain('serviceNotification()');
    expect(cancel).toContain('manager.cancel(');
  });
});
