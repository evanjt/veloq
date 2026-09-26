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

import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { writeProvisionalActivity } from '@/features/recording/lib/storage/provisionalActivity';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@tanstack/react-query', () => ({
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
jest.mock('@/features/recording/lib/upload/uploadRecording', () => ({
  uploadRecording: jest.fn(async () => ({ outcome: 'uploaded' })),
}));
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn(async () => undefined),
}));
jest.mock('@/features/auth', () => ({ isOAuthConfigured: () => true }));
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  createManualActivity: jest.fn(async () => 'i789'),
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
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as never;
  }) as never);
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
    (uploadRecording as jest.Mock).mockImplementation(async () => {
      order.push('post');
      return { outcome: 'uploaded' };
    });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    expect(order).toEqual(['save', 'provisional', 'post']);
    expect(saveRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        manualBody: expect.objectContaining({ name: 'Turbo session', elapsed_time: 2700 }),
        uploadStatus: 'pending',
      })
    );
  });

  it('keeps the entry and offers a retry when the server refuses it', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({
      outcome: 'rejected',
      errorDetail: 'server said no',
    });

    const { result } = renderHook(() => useReviewSave(args()));
    await act(() => result.current.handleSave());

    expect(saveRecording).toHaveBeenCalled();
    expect(result.current.canRetry).toBe(true);
    expect(result.current.errorMessage).not.toBeNull();
  });

  it('leaves it to the queue when the post cannot reach the server', async () => {
    (uploadRecording as jest.Mock).mockResolvedValue({
      outcome: 'network',
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
    expect(uploadRecording).not.toHaveBeenCalled();
  });
});
