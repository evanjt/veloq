/**
 * Scenario: the device is nearly full, so every write of the growing crash
 * backup fails. The last good snapshot survives, but it goes stale from the
 * first failure, and a kill an hour later loses everything after it.
 *
 * Expected behaviour: every backup write reports its outcome to one place, the
 * live store's count of consecutive failures. A failure raises it, a write that
 * lands clears it, and the stop handler counts the same way so the review
 * screen can tell the rider the stopped ride has no backup.
 */

import * as Location from 'expo-location';

import { BACKUP_INTERVAL_MS } from '@/features/recording/lib/constants';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { installRecordingSession } from '@/features/recording/lib/recordingSession';
import { resumeStoppedRecording } from '@/features/recording/lib/resumeStoppedRecording';
import { selectStatusMessage } from '@/features/recording/lib/statusSlot';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockSave = jest.fn<Promise<boolean>, [unknown]>();

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => ({ startTime: 1 })),
  saveRecordingBackup: (backup: unknown) => mockSave(backup),
  clearRecordingBackup: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  replaceTo: jest.fn(),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
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

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const failures = () => useRecordingLiveStore.getState().backupFailures;

describe('a failed crash-backup write', () => {
  let uninstall: () => void;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (Location.watchPositionAsync as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    mockSave.mockResolvedValue(true);
    useRecordingStore.getState().reset();
    useRecordingLiveStore.getState().reset();
    uninstall = installRecordingSession();
  });

  afterEach(() => {
    uninstall();
    jest.useRealTimers();
  });

  it('is counted when the first write of a ride fails', async () => {
    mockSave.mockResolvedValue(false);

    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    expect(failures()).toBe(1);
  });

  it('keeps counting while the periodic writes fail, and clears on one that lands', async () => {
    mockSave.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();

    jest.advanceTimersByTime(BACKUP_INTERVAL_MS);
    await settle();
    expect(failures()).toBe(2);

    mockSave.mockResolvedValue(true);
    jest.advanceTimersByTime(BACKUP_INTERVAL_MS);
    await settle();
    expect(failures()).toBe(0);
  });

  it('counts nothing while every write lands', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    jest.advanceTimersByTime(BACKUP_INTERVAL_MS);
    await settle();

    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(failures()).toBe(0);
  });

  it('is counted for the stopped ride, so review can say it has no backup', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    mockSave.mockResolvedValue(false);

    await endRecordingSession();

    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(failures()).toBe(1);
  });

  it('is cleared for the stopped ride once a later write lands', async () => {
    mockSave.mockResolvedValue(false);
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    mockSave.mockResolvedValue(true);

    await endRecordingSession();

    expect(failures()).toBe(0);
  });

  it('is counted when the ride resumed from review cannot be written', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    await settle();
    await endRecordingSession();
    mockSave.mockResolvedValue(false);

    await resumeStoppedRecording();
    await settle();

    expect(useRecordingStore.getState().status).toBe('paused');
    expect(failures()).toBeGreaterThanOrEqual(1);
  });
});

describe('the live screen status slot', () => {
  const quiet = {
    backgroundTrackingWarning: null,
    gpsWarning: null,
    sensorIssue: null,
    splitBanner: null,
  };

  it('shows the backup warning', () => {
    expect(selectStatusMessage({ ...quiet, backupWarning: 'not backed up' })).toEqual({
      kind: 'backup',
      text: 'not backed up',
      spoken: 'not backed up',
    });
  });

  it('puts a refused background service ahead of it, and it ahead of a weak signal', () => {
    expect(
      selectStatusMessage({ ...quiet, backgroundTrackingWarning: 'service', backupWarning: 'b' })
        ?.kind
    ).toBe('background');
    expect(selectStatusMessage({ ...quiet, gpsWarning: 'signal', backupWarning: 'b' })?.kind).toBe(
      'backup'
    );
  });
});
