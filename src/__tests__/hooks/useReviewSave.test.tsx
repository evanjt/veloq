/**
 * Orchestration tests for useReviewSave — the local-save-first save flow.
 *
 * Scenario: saving a GPS recording must persist to the library before any
 * upload attempt, clear the crash backup only after the library save
 * succeeds, and never create a duplicate entry on retry.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { router } from 'expo-router';
import type { RecordingStreams } from '@/features/recording/types';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn().mockResolvedValue(new ArrayBuffer(64)),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(),
}));

jest.mock('@/features/recording/lib/upload/uploadRecording', () => ({
  uploadRecording: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/auth', () => ({
  isOAuthConfigured: () => true,
}));

jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: jest.fn(),
    isUpgrading: false,
    error: null,
  }),
}));

jest.mock('@/api', () => ({
  intervalsApi: { createManualActivity: jest.fn() },
}));

const mockSaveRecording = saveRecording as jest.Mock;
const mockUploadRecording = uploadRecording as jest.Mock;
const mockClearBackup = clearRecordingBackup as jest.Mock;
const mockGenerateFit = generateFitFile as jest.Mock;

const STREAMS: RecordingStreams = {
  time: [0, 1, 2],
  latlng: [
    [45.0, 10.0],
    [45.001, 10.001],
    [45.002, 10.002],
  ],
  altitude: [100, 101, 102],
  heartrate: [120, 130, 140],
  power: [0, 0, 0],
  cadence: [0, 0, 0],
  speed: [8, 8, 8],
  distance: [0, 8, 16],
};

const ENTRY = { id: 'rec-1', uploadStatus: 'pending' } as never;

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    isManual: false,
    type: 'Ride' as const,
    name: 'Morning Ride',
    summary: { duration: 2, distance: 16, avgHeartrate: 130, elevationGain: 2 },
    notes: '',
    startTime: 1_700_000_000_000,
    pausedDuration: 0,
    laps: [],
    pairedEventId: null,
    getTrimmedStreams: () => STREAMS,
    canTrim: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // finishAndGoHome defers navigation 1.5s to show the queued toast; run it
  // inline so the suite leaves no open timer handles.
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as never;
  }) as never);
  mockGenerateFit.mockResolvedValue(new ArrayBuffer(64));
  mockSaveRecording.mockResolvedValue(ENTRY);
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({ hasWritePermission: null, needsUpgrade: false });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useReviewSave', () => {
  it('saves to the library before uploading and clears the backup after the save', async () => {
    const order: string[] = [];
    mockSaveRecording.mockImplementation(async () => {
      order.push('save');
      return ENTRY;
    });
    mockClearBackup.mockImplementation(async () => {
      order.push('clearBackup');
    });
    mockUploadRecording.mockImplementation(async () => {
      order.push('upload');
      return { outcome: 'uploaded' };
    });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(order).toEqual(['save', 'clearBackup', 'upload']);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('does not clear the backup when the library save fails', async () => {
    mockSaveRecording.mockResolvedValue(null);

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockUploadRecording).not.toHaveBeenCalled();
    expect(result.current.errorMessage).not.toBeNull();
    expect(result.current.canRetry).toBe(true);
  });

  it('skips upload entirely when auto-upload is off', async () => {
    useRecordingPreferences.setState({ autoUploadEnabled: false });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ uploadStatus: 'localOnly' })
    );
    expect(mockUploadRecording).not.toHaveBeenCalled();
    expect(result.current.queuedMessage).not.toBeNull();
  });

  it('reuses the saved entry on retry instead of duplicating it', async () => {
    mockUploadRecording
      .mockResolvedValueOnce({ outcome: 'rejected', errorDetail: 'bad file' })
      .mockResolvedValueOnce({ outcome: 'uploaded' });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(true);
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);

    await act(() => result.current.handleSave());
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('offers the OAuth fix and flips the permission store on 403', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: 'permissionBlocked' });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(useUploadPermissionStore.getState().hasWritePermission).toBe(false);
    expect(result.current.showPermissionFix).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('treats network failure as saved-and-queued, not an error', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: 'network' });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.queuedMessage).not.toBeNull();
  });

  it('rebases trimmed streams so the offset is not double-counted', async () => {
    const trimmed: RecordingStreams = {
      ...STREAMS,
      time: [10, 11, 12],
      distance: [100, 108, 116],
    };
    mockUploadRecording.mockResolvedValue({ outcome: 'uploaded' });

    const { result } = renderHook(() =>
      useReviewSave(makeArgs({ getTrimmedStreams: () => trimmed, canTrim: true }))
    );
    await act(() => result.current.handleSave());

    const fitArgs = mockGenerateFit.mock.calls[0][0];
    expect(fitArgs.streams.time).toEqual([0, 1, 2]);
    expect(fitArgs.streams.distance).toEqual([0, 8, 16]);
    expect(fitArgs.startTime.getTime()).toBe(1_700_000_000_000 + 10_000);
  });
});
