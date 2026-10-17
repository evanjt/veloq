/**
 * Scenario: a ride is saved but its upload waits, for the network, for a sign-in or because
 * auto-upload is off. The sentence that says where the ride went is the only statement of it.
 *
 * Expected behaviour: the review goes home at once and the sentence arrives as the app notice,
 * which outlives the review, is announced, and offers the way to My Recordings. It is still on
 * screen once the review is long gone.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { UploadOutcome } from 'veloqrs';

import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { hideNotice, NoticeHost, showNotice } from '@/shared/ui/Notice';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn(async () => new ArrayBuffer(64)),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(),
  attachEngineActivity: jest.fn(async () => null),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/provisionalActivity'),
  writeProvisionalActivity: jest.fn(async () => 'local-cafe'),
}));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn(async () => undefined),
}));
jest.mock('@/features/auth', () => ({ isOAuthConfigured: () => true }));
jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({ upgradePermissions: jest.fn(), isUpgrading: false, error: null }),
}));
jest.mock('@/shared/native/syncRefresh', () => ({ requestSyncRefresh: jest.fn() }));
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

const START = 1_700_000_000_000;

const ARGS = {
  isManual: false,
  type: 'Ride' as const,
  name: 'Harbour loop',
  summary: { duration: 2, distance: 16, avgHeartrate: 130, elevationGain: 2 },
  notes: '',
  startTime: START,
  pausedSecondsInWindow: 0,
  laps: [],
  pairedEventId: null,
  getTrimmedStreams: () => ({
    time: [0, 1, 2],
    latlng: [
      [45.0, 10.0],
      [45.001, 10.001],
      [45.002, 10.002],
    ] as [number, number][],
    altitude: [100, 101, 102],
    heartrate: [120, 130, 140],
    power: [0, 0, 0],
    cadence: [0, 0, 0],
    speed: [8, 8, 8],
    distance: [0, 8, 16],
  }),
  canTrim: false,
  trimStartIndex: 0,
};

let save: () => Promise<void> = async () => {};

function Review() {
  const { handleSave } = useReviewSave(ARGS);
  useEffect(() => {
    save = handleSave;
  }, [handleSave]);
  return null;
}

/** The review as a screen of its own: leaving home unmounts it, the notice host stays. */
async function saveFromReview() {
  const view = await render(
    <>
      <Review />
      <NoticeHost />
    </>
  );
  await act(() => save());
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  useRecordingStore.getState().reset();
  useRecordingStore.setState({
    status: 'stopped',
    athleteId: 'athlete-a',
    mode: 'gps',
    startTime: START,
  });
  (saveRecording as jest.Mock).mockResolvedValue({ id: 'rec-1', uploadStatus: 'pending' });
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({ hasWritePermission: null, recordingWithoutScope: false });
});

afterEach(() => {
  // The notice outlives every screen, so one test's would otherwise open the next.
  hideNotice(showNotice({ message: '' }));
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the saved-but-waiting confirmation', () => {
  it.each([
    ['Network', UploadOutcome.Network, 'recording.savedQueued'],
    ['Retriable', UploadOutcome.Retriable, 'recording.savedQueued'],
    ['NotStarted', UploadOutcome.NotStarted, 'recording.savedQueued'],
    ['AuthExpired', UploadOutcome.AuthExpired, 'recording.savedQueuedAuth'],
    ['OtherAthlete', UploadOutcome.OtherAthlete, 'recording.savedQueuedAuth'],
  ])('goes home at once and leaves the notice for %s on screen', async (_name, outcome, key) => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({ outcome });

    await saveFromReview();

    expect(router.dismissTo).toHaveBeenCalledWith('/');
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(key);

    await act(() => jest.advanceTimersByTime(1500));
    expect(screen.getByText(key)).toBeTruthy();
    expect(screen.getByText('recording.library.title')).toBeTruthy();
    expect(router.dismissTo).toHaveBeenCalledTimes(1);
  });

  it('opens My Recordings from the notice', async () => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({ outcome: UploadOutcome.Network });

    await saveFromReview();
    await fireEvent.press(screen.getByText('recording.library.title'));

    expect(router.push).toHaveBeenCalledWith('/recordings');
  });

  it('says the ride stays on the device when auto-upload is off', async () => {
    useRecordingPreferences.setState({ autoUploadEnabled: false });

    await saveFromReview();

    expect(router.dismissTo).toHaveBeenCalledWith('/');
    expect(uploadRecordingNow).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1500));
    expect(screen.getByText('recording.savedLocally')).toBeTruthy();
  });

  it('goes home with no notice when the upload landed', async () => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    await saveFromReview();

    expect(router.dismissTo).toHaveBeenCalledWith('/');
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(screen.queryByText('recording.library.title')).toBeNull();
  });
});
