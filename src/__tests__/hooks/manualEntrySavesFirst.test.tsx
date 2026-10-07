/**
 * Scenario: the review screen's manual branch awaited the network and treated
 * the result as the save, so offline the entry existed nowhere: no row, no
 * provisional activity, and no retry on the banner.
 *
 * Expected behaviour: the manual branch saves the row first and posts second,
 * exactly as the recorded branch does, so the entry survives an offline save and
 * a relaunch, and a failed post leaves a retry.
 */

import { renderHook, act } from '@testing-library/react-native';
import { UploadOutcome } from 'veloqrs';

import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { writeProvisionalActivity } from '@/features/recording/lib/storage/provisionalActivity';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn(async () => new ArrayBuffer(8)),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(async () => ({ id: 'rec-man-1', kind: 'manual' })),
  attachEngineActivity: jest.fn(async () => null),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  writeProvisionalActivity: jest.fn(async () => 'local-manual'),
}));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn(async () => undefined),
}));
jest.mock('@/features/auth', () => ({ isOAuthConfigured: () => true }));
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

function args() {
  return {
    isManual: true,
    type: 'VirtualRide' as const,
    name: 'Turbo session',
    summary: { duration: 2700, distance: 0, avgHeartrate: 138, elevationGain: 0 },
    notes: 'trainer',
    startTime: 1_757_500_000_000,
    pausedSecondsInWindow: 0,
    laps: [],
    pairedEventId: null,
    getTrimmedStreams: () => undefined as never,
    canTrim: false,
    trimStartIndex: 0,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('VirtualRide', 'manual');
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as never;
  }) as never);
  (uploadRecordingNow as jest.Mock).mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({ hasWritePermission: true, recordingWithoutScope: false });
});

afterEach(() => jest.restoreAllMocks());

describe('saving a manual entry', () => {
  it('writes the row and the provisional activity before it posts anything', async () => {
    const order: string[] = [];
    (saveRecording as jest.Mock).mockImplementation(async () => {
      order.push('save');
      return { id: 'rec-man-1', kind: 'manual' };
    });
    (writeProvisionalActivity as jest.Mock).mockImplementation(async () => {
      order.push('provisional');
      return 'local-manual';
    });
    (uploadRecordingNow as jest.Mock).mockImplementation(async () => {
      order.push('post');
      return { outcome: UploadOutcome.Uploaded };
    });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    expect(order).toEqual(['save', 'provisional', 'post']);
    expect(uploadRecordingNow).toHaveBeenCalledWith('rec-man-1');
    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        manualBody: expect.objectContaining({ name: 'Turbo session', elapsed_time: 2700 }),
        uploadStatus: 'pending',
      })
    );
  });

  it('leaves a held ride backup untouched when a manual entry saves', async () => {
    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());
    expect(clearRecordingBackup).not.toHaveBeenCalled();
  });

  it('does not finish an old athlete’s save over a new recording', async () => {
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Yoga', 'manual');
    let finishSave!: (entry: { id: string; kind: string }) => void;
    (saveRecording as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    const { result } = renderHook(() => useReviewSave(args()));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.handleSave();
      useAuthStore.setState({ athleteId: 'i2', isAuthenticated: true });
      useRecordingStore.getState().reset();
      useRecordingStore.getState().startRecording('Ride', 'gps');
      finishSave({ id: 'old-manual', kind: 'manual' });
      await pending;
    });
    expect(useRecordingStore.getState().activityType).toBe('Ride');
    expect(writeProvisionalActivity).not.toHaveBeenCalled();
    expect(uploadRecordingNow).not.toHaveBeenCalled();
  });

  it('keeps the entry and offers a retry when the server refuses it', async () => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({
      outcome: UploadOutcome.Rejected,
      errorDetail: 'server said no',
    });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    expect(saveRecording).toHaveBeenCalled();
    expect(result.current.canRetry).toBe(true);
    expect(result.current.errorMessage).not.toBeNull();
  });

  it('leaves it to the queue when the post cannot reach the server', async () => {
    (uploadRecordingNow as jest.Mock).mockResolvedValue({
      outcome: UploadOutcome.Network,
      errorDetail: 'offline',
    });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    // The row is saved and the queue owns the retry, so the screen says so and
    // goes home rather than holding the athlete on a red banner.
    expect(saveRecording).toHaveBeenCalled();
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.queuedMessage).not.toBeNull();
  });

  it('saves the row and posts nothing with auto-upload off', async () => {
    useRecordingPreferences.setState({ autoUploadEnabled: false });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ uploadStatus: 'localOnly' })
    );
    expect(uploadRecordingNow).not.toHaveBeenCalled();
  });
});
