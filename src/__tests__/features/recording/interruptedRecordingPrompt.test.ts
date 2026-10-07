/**
 * Scenario: the record screen opens after an app kill left a ride in the
 * crash backup.
 *
 * Expected behaviour: the resume prompt names the ride from the backup it
 * loaded, Discard deletes that backup and Resume restores it. A file that
 * cannot be read raises nothing and is left where it is, and a session already
 * in memory is never offered its own backup.
 */

import { Alert } from 'react-native';

import { initializeI18n } from '@/i18n';
import { promptInterruptedRecording } from '@/features/recording/lib/interruptedRecording';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingBackup } from '@/features/recording/types';

const mockLoadBackup = jest.fn();
const mockClearBackup = jest.fn();
const mockResume = jest.fn();
const mockNavigateTo = jest.fn();

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  loadRecordingBackup: () => mockLoadBackup(),
  clearRecordingBackup: () => mockClearBackup(),
}));

jest.mock('@/features/recording/lib/restoreRecordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/restoreRecordingBackup'),
  resumeRecordingBackup: () => mockResume(),
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

const START = Date.UTC(2026, 8, 30, 6, 15, 0);

const twoHourRide: RecordingBackup = {
  athleteId: 'i1',
  activityType: 'Ride',
  mode: 'gps',
  status: 'recording',
  startTime: START,
  stopTime: null,
  pausedDuration: 0,
  pauseIntervals: [],
  streams: {
    time: [],
    latlng: [],
    altitude: [],
    heartrate: [],
    power: [],
    cadence: [],
    speed: [],
    distance: [],
  },
  laps: [],
  pairedEventId: null,
  savedAt: START + 2 * 3_600_000,
};

type AlertButton = { text?: string; style?: string; onPress?: () => unknown };

function lastAlert(): { body: string; buttons: AlertButton[] } {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [, body, buttons] = calls[calls.length - 1];
  return { body, buttons };
}

beforeAll(async () => {
  await initializeI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
  mockLoadBackup.mockResolvedValue(twoHourRide);
});

describe('the resume prompt on the record screen', () => {
  it('does not disclose a backup while signed out or to another athlete', async () => {
    useAuthStore.setState({ athleteId: null, isAuthenticated: false });
    await promptInterruptedRecording();
    expect(Alert.alert).not.toHaveBeenCalled();
    useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
    await promptInterruptedRecording();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not show a backup if the account changes while it loads', async () => {
    let finish!: (backup: RecordingBackup) => void;
    mockLoadBackup.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const prompt = promptInterruptedRecording();
    useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
    finish(twoHourRide);
    await prompt;
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not show a stale backup after a new ride starts while it loads', async () => {
    let finish!: (backup: RecordingBackup) => void;
    mockLoadBackup.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const prompt = promptInterruptedRecording();
    useRecordingStore.getState().startRecording('Ride', 'gps');
    finish(twoHourRide);
    await prompt;
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not discard or resume after the account changes with the alert open', async () => {
    await promptInterruptedRecording();
    const buttons = lastAlert().buttons;
    useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    await buttons.find((b) => b.style !== 'destructive')?.onPress?.();
    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
  });

  it('does not discard a new ride started while the alert is open', async () => {
    await promptInterruptedRecording();
    const buttons = lastAlert().buttons;
    useRecordingStore.getState().startRecording('Ride', 'gps');
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(mockClearBackup).not.toHaveBeenCalled();
  });
  it('names the ride it loaded', async () => {
    await promptInterruptedRecording();

    expect(lastAlert().body).toContain('2:00:00');
  });

  it('deletes the backup on Discard', async () => {
    await promptInterruptedRecording();

    lastAlert()
      .buttons.find((b) => b.style === 'destructive')
      ?.onPress?.();

    expect(mockClearBackup).toHaveBeenCalledTimes(1);
  });

  it('restores the ride on Resume and opens where it left off', async () => {
    mockResume.mockResolvedValue('/recording/Ride');
    await promptInterruptedRecording();

    await lastAlert()
      .buttons.find((b) => b.style !== 'destructive')
      ?.onPress?.();

    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockNavigateTo).toHaveBeenCalledWith('/recording/Ride');
  });

  it('raises nothing for a backup it cannot read, and leaves the file alone', async () => {
    mockLoadBackup.mockResolvedValue(null);

    await promptInterruptedRecording();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockClearBackup).not.toHaveBeenCalled();
  });

  it('offers nothing while a session is in memory, which owns the backup', async () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');

    await promptInterruptedRecording();

    expect(mockLoadBackup).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
