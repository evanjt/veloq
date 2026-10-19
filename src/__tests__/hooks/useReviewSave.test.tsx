/**
 * Orchestration tests for useReviewSave - the local-save-first save flow.
 *
 * Scenario: saving a GPS recording must persist to the library before any
 * upload attempt, clear the crash backup only after the library save
 * succeeds, and never create a duplicate entry on retry.
 */

import { renderHook, act } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { UploadOutcome } from 'veloqrs';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingLibraryEntry } from '@/types';
import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import {
  attachEngineActivity,
  saveRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
import {
  buildProvisionalBody,
  writeProvisionalActivity,
} from '@/features/recording/lib/storage/provisionalActivity';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { router } from 'expo-router';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { shareRecordingFit } from '@/features/recording/lib/shareRecordingFit';
import type { RecordingStreams } from '@/features/recording/types';
import * as haptics from '@/shared/ui/haptics';
import { showNotice } from '@/shared/ui/Notice';

jest.mock('@/shared/ui/haptics', () => ({
  selection: jest.fn(),
  light: jest.fn(),
  medium: jest.fn(),
  success: jest.fn(),
}));

jest.mock('@/shared/ui/Notice', () => ({
  ...jest.requireActual('@/shared/ui/Notice'),
  showNotice: jest.fn(),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn().mockResolvedValue(new ArrayBuffer(64)),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(),
  attachEngineActivity: jest.fn(async () => null),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/provisionalActivity'),
  writeProvisionalActivity: jest.fn(async () => 'local-deadbeef'),
}));

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  clearRecordingBackup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/auth', () => ({
  isOAuthConfigured: () => true,
}));

const mockUpgradeOutcome = jest.fn<Promise<{ granted: boolean; error: string | null }>, []>();

jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: mockUpgradeOutcome,
    isUpgrading: false,
    error: null,
  }),
}));

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
}));

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

jest.mock('@/features/recording/lib/shareRecordingFit', () => ({
  shareRecordingFit: jest.fn(async () => true),
}));

const mockRequestSyncRefresh = requestSyncRefresh as jest.Mock;
const mockSaveRecording = saveRecording as jest.Mock;
const mockAttachEngineActivity = attachEngineActivity as jest.Mock;
const mockWriteProvisional = writeProvisionalActivity as jest.Mock;
const mockUploadRecording = uploadRecordingNow as jest.Mock;
const mockClearBackup = clearRecordingBackup as jest.Mock;
const mockGenerateFit = generateFitFile as jest.Mock;
const mockShareFit = shareRecordingFit as jest.Mock;

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
    pausedSecondsInWindow: 0,
    laps: [],
    pairedEventId: null,
    getTrimmedStreams: () => STREAMS,
    canTrim: false,
    trimStartIndex: 0,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  useRecordingStore.getState().reset();
  useRecordingStore.setState({
    status: 'stopped',
    athleteId: 'athlete-a',
    mode: 'gps',
    startTime: 1_700_000_000_000,
  });
  // Timers run inline so the suite leaves no open handles.
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
    cb();
    return 0 as never;
  }) as never);
  mockGenerateFit.mockResolvedValue(new ArrayBuffer(64));
  mockSaveRecording.mockResolvedValue(ENTRY);
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({
    hasWritePermission: null,
    needsUpgrade: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useReviewSave', () => {
  it('does not save an ownerless stopped ride after the handoff clears the store', async () => {
    useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
    useRecordingStore.getState().reset();

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).not.toHaveBeenCalled();
    expect(mockGenerateFit).not.toHaveBeenCalled();
  });

  it("does not save another athlete's stopped ride during a pending handoff", async () => {
    useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
    useRecordingStore.setState({ status: 'stopped', athleteId: 'athlete-a' });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).not.toHaveBeenCalled();
    expect(mockGenerateFit).not.toHaveBeenCalled();
  });

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
      return { outcome: UploadOutcome.Uploaded };
    });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(order).toEqual(['save', 'clearBackup', 'upload']);
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });

  it('does not clear the backup when the library save fails', async () => {
    mockSaveRecording.mockResolvedValue(null);

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockUploadRecording).not.toHaveBeenCalled();
    expect(result.current.errorMessage).not.toBeNull();
    expect(result.current.canRetry).toBe(true);
  });

  describe('a failed save on a nearly full device', () => {
    const MB = 1024 * 1024;

    function freeSpace(bytes: number | Error) {
      return jest
        .spyOn(FileSystem, 'getFreeDiskStorageAsync')
        .mockImplementation(async () => (bytes instanceof Error ? Promise.reject(bytes) : bytes));
    }

    it('names the space and offers to free it, keeping Retry', async () => {
      freeSpace(10 * MB);
      mockSaveRecording.mockResolvedValue(null);

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(result.current.errorMessage).toBe('recording.saveErrorNoSpace');
      expect(result.current.lowStorage).toBe(true);
      expect(result.current.canRetry).toBe(true);
    });

    it('names the space for a manual entry too', async () => {
      freeSpace(10 * MB);
      mockSaveRecording.mockResolvedValue(null);
      useRecordingStore.setState({ status: 'recording', mode: 'manual' });

      const { result } = await renderHook(() => useReviewSave(makeArgs({ isManual: true })));
      await act(() => result.current.handleSave());

      expect(result.current.errorMessage).toBe('recording.saveErrorNoSpace');
      expect(result.current.lowStorage).toBe(true);
    });

    it('keeps the plain message when the device has room', async () => {
      freeSpace(4096 * MB);
      mockSaveRecording.mockResolvedValue(null);

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(result.current.errorMessage).toBe('recording.saveError');
      expect(result.current.lowStorage).toBe(false);
    });

    it('keeps the plain message when free space cannot be read', async () => {
      freeSpace(new Error('no answer from the platform'));
      mockSaveRecording.mockResolvedValue(null);

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(result.current.errorMessage).toBe('recording.saveError');
      expect(result.current.lowStorage).toBe(false);
    });

    it('drops the space action once a retry saves', async () => {
      freeSpace(10 * MB);
      mockSaveRecording.mockResolvedValueOnce(null);
      mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());
      expect(result.current.lowStorage).toBe(true);

      await act(() => result.current.handleSave());
      expect(result.current.lowStorage).toBe(false);
      expect(result.current.errorMessage).toBeNull();
    });
  });

  it('skips upload entirely when auto-upload is off', async () => {
    useRecordingPreferences.setState({ autoUploadEnabled: false });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ uploadStatus: 'localOnly' })
    );
    expect(mockUploadRecording).not.toHaveBeenCalled();
    expect(showNotice).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recording.savedLocally' })
    );
  });

  describe('under a source that cannot upload', () => {
    beforeEach(() => {
      useAuthStore.setState({
        authMethod: 'demo',
        isDemoMode: true,
        athleteId: 'demo',
        isAuthenticated: true,
      });
      useRecordingStore.setState({ athleteId: 'demo' });
    });

    it('keeps the ride on the device with auto-upload on, and never hands it to the upload', async () => {
      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(mockSaveRecording).toHaveBeenCalledWith(
        expect.objectContaining({ uploadStatus: 'localOnly' })
      );
      expect(mockUploadRecording).not.toHaveBeenCalled();
      expect(showNotice).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'recording.savedLocallyNoUpload' })
      );
    });

    it('keeps the ride on the device with auto-upload off', async () => {
      useRecordingPreferences.setState({ autoUploadEnabled: false });

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(mockSaveRecording).toHaveBeenCalledWith(
        expect.objectContaining({ uploadStatus: 'localOnly' })
      );
      expect(mockUploadRecording).not.toHaveBeenCalled();
    });

    it('keeps a manual entry on the device', async () => {
      useRecordingStore.setState({ status: 'recording', mode: 'manual' });

      const { result } = await renderHook(() => useReviewSave(makeArgs({ isManual: true })));
      await act(() => result.current.handleSave());

      expect(mockSaveRecording).toHaveBeenCalledWith(
        expect.objectContaining({ uploadStatus: 'localOnly' })
      );
      expect(mockUploadRecording).not.toHaveBeenCalled();
    });
  });

  it.each(['oauth', 'apiKey'] as const)(
    'saves a %s ride pending and hands it to the upload',
    async (authMethod) => {
      useAuthStore.setState({ authMethod, isDemoMode: false });
      mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

      const { result } = await renderHook(() => useReviewSave(makeArgs()));
      await act(() => result.current.handleSave());

      expect(mockSaveRecording).toHaveBeenCalledWith(
        expect.objectContaining({ uploadStatus: 'pending' })
      );
      expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
    }
  );

  it('reuses the saved entry on retry instead of duplicating it', async () => {
    mockUploadRecording
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(true);
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);

    await act(() => result.current.handleSave());
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledTimes(2);
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });

  /**
   * Scenario: intervals.icu refuses the file, which the same bytes sent again
   * cannot change, so the ride parks in the library.
   *
   * Expected behaviour: no Retry, a translated line saying the ride is kept,
   * the server's words only as the secondary detail, and the kept ride offered
   * to open or share.
   */
  it('offers the kept ride rather than a retry when intervals.icu refuses the file', async () => {
    mockUploadRecording.mockResolvedValue({
      outcome: UploadOutcome.Rejected,
      errorDetail: 'Duplicate activity',
    });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(false);
    expect(result.current.errorMessage).toBe('recording.uploadRejected');
    expect(result.current.errorDetail).toBe('Duplicate activity');
    expect(result.current.keptRecording).toEqual(expect.objectContaining({ id: 'rec-1' }));

    await act(() => result.current.shareKeptRecording());
    expect(mockShareFit).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1' }), undefined);
  });

  it('leaves the detail out when the refusal carries none', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBe('recording.uploadRejected');
    expect(result.current.errorDetail).toBeNull();
  });

  it('offers no retry and nothing to share when the ride file is gone', async () => {
    mockUploadRecording.mockResolvedValue({
      outcome: UploadOutcome.Missing,
      errorDetail: 'no such file /data/recordings/rec-1.fit',
    });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(false);
    expect(result.current.errorMessage).toBe('recording.uploadMissing');
    expect(result.current.errorDetail).toBeNull();
    expect(result.current.keptRecording).toBeNull();
  });

  it('offers a retry for a thrown upload, in its translated line rather than the raw message', async () => {
    mockUploadRecording.mockRejectedValue(new Error('socket closed'));

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(true);
    expect(result.current.errorMessage).toBe('recording.uploadFailed');
    expect(result.current.errorDetail).toBeNull();
    expect(result.current.keptRecording).toBeNull();
  });

  it('clears the refusal when the next save uploads', async () => {
    mockUploadRecording
      .mockResolvedValueOnce({ outcome: UploadOutcome.Rejected, errorDetail: 'Duplicate activity' })
      .mockResolvedValueOnce({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.errorDetail).toBeNull();
    expect(result.current.keptRecording).toBeNull();
  });

  it('explains the missing permission and offers the OAuth fix on 403', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.PermissionBlocked });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBe('recording.permissionExplanation');
    expect(result.current.showPermissionFix).toBe(true);
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('shows why the permission grant failed and keeps the fix on screen', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.PermissionBlocked });
    mockUpgradeOutcome.mockResolvedValue({ granted: false, error: 'login.oauthUnreachable' });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleUpgradeToOAuth());

    expect(result.current.errorMessage).toBe('login.oauthUnreachable');
    expect(result.current.showPermissionFix).toBe(true);
    expect(mockUploadRecording).toHaveBeenCalledTimes(1);
  });

  it('shows the second failure of a repeated permission grant', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.PermissionBlocked });
    mockUpgradeOutcome.mockResolvedValue({ granted: false, error: 'login.oauthUnreachable' });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleUpgradeToOAuth());
    await act(() => result.current.setErrorMessage(null));
    await act(() => result.current.handleUpgradeToOAuth());

    expect(result.current.errorMessage).toBe('login.oauthUnreachable');
    expect(result.current.showPermissionFix).toBe(true);
  });

  it('leaves the permission explanation and its fix when the grant is cancelled', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.PermissionBlocked });
    mockUpgradeOutcome.mockResolvedValue({ granted: false, error: null });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleUpgradeToOAuth());

    expect(result.current.errorMessage).toBe('recording.permissionExplanation');
    expect(result.current.showPermissionFix).toBe(true);
    expect(mockUploadRecording).toHaveBeenCalledTimes(1);
  });

  it('retries the upload once the permission is granted', async () => {
    mockUploadRecording
      .mockResolvedValueOnce({ outcome: UploadOutcome.PermissionBlocked })
      .mockResolvedValueOnce({ outcome: UploadOutcome.Uploaded, activityId: 'i1' });
    mockUpgradeOutcome.mockResolvedValue({ granted: true, error: null });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleUpgradeToOAuth());

    expect(result.current.showPermissionFix).toBe(false);
    expect(mockUploadRecording).toHaveBeenCalledTimes(2);
  });

  it('treats network failure as saved-and-queued, not an error', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBeNull();
    expect(showNotice).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recording.savedQueued' })
    );
  });

  it('finishes a saved recording when its upload needs a fresh sign-in', async () => {
    useRecordingStore.setState({ status: 'stopped' });
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.AuthExpired });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.isUploading).toBe(false);
    expect(result.current.errorMessage).toBeNull();
    expect(showNotice).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'recording.savedQueuedAuth' })
    );
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(router.dismissTo).toHaveBeenCalledWith('/');
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  });

  it.each([new Date(2026, 8, 23, 7, 30).getTime(), 0, null])(
    'saves a manual entry with the same local start as its provisional activity (%s)',
    async (startTime) => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 24, 1));
      mockSaveRecording.mockImplementation(async (params) => ({ ...params, id: 'manual-1' }));
      mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
      useRecordingStore.setState({ status: 'recording', mode: 'manual' });
      const { result } = await renderHook(() =>
        useReviewSave(makeArgs({ isManual: true, startTime }))
      );

      await act(() => result.current.handleSave());

      const saved = mockSaveRecording.mock.calls[0][0];
      const expectedStart = startTime ?? Date.UTC(2026, 8, 24, 1);
      expect(saved.startTime).toBe(expectedStart);
      expect(saved.manualBody.start_date_local).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/);
      expect(saved.manualBody.start_date_local).toBe(
        buildProvisionalBody(saved as RecordingLibraryEntry, 'local-manual').start_date_local
      );
      expect(mockWriteProvisional).toHaveBeenCalledWith(
        expect.objectContaining({ startTime: expectedStart })
      );
      if (startTime === new Date(2026, 8, 23, 7, 30).getTime()) {
        expect(saved.manualBody.start_date_local).toBe('2026-09-23T07:30:00');
      }
    }
  );

  it('rebases trimmed streams so the offset is not double-counted', async () => {
    const trimmed: RecordingStreams = {
      ...STREAMS,
      time: [10, 11, 12],
      distance: [100, 108, 116],
    };
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() =>
      useReviewSave(makeArgs({ getTrimmedStreams: () => trimmed, canTrim: true }))
    );
    await act(() => result.current.handleSave());

    const fitArgs = mockGenerateFit.mock.calls[0][0];
    expect(fitArgs.streams.time).toEqual([0, 1, 2]);
    expect(fitArgs.streams.distance).toEqual([0, 8, 16]);
    expect(fitArgs.startTime.getTime()).toBe(1_700_000_000_000 + 10_000);
  });

  /**
   * Scenario: a ride uploads, and the feed reads the engine, which has not
   * synced yet.
   *
   * Expected behaviour: the save asks the engine for a sync, and a sync that
   * throws does not stop the athlete reaching home.
   */
  it('starts an engine sync after a successful upload', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(1);
  });

  it('still goes home when the post-upload sync request throws', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
    mockRequestSyncRefresh.mockImplementationOnce(() => {
      throw new Error('engine gone');
    });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });

  it('requests no sync when the upload fails', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockRequestSyncRefresh).not.toHaveBeenCalled();
  });

  it('writes the provisional engine row from the saved FIT, and keeps no streams copy', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockWriteProvisional).toHaveBeenCalledWith(ENTRY);
    expect(mockSaveRecording.mock.calls[0][0]).not.toHaveProperty('streams');
    expect(mockAttachEngineActivity).toHaveBeenCalledWith('rec-1', 'local-deadbeef');
  });

  /**
   * Scenario: the athlete drags the effort slider to 8 and writes "legs heavy"
   * under "How did it feel?", then saves.
   *
   * Expected behaviour: both reach the library row the upload reads, now or
   * from the queue after a relaunch.
   */
  it("saves the review's notes and effort on the ride", async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() =>
      useReviewSave(makeArgs({ notes: 'legs heavy', rpe: 8 }))
    );
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'legs heavy', rpe: 8 })
    );
  });

  it('saves no effort when the slider was never moved', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs({ rpe: null })));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording.mock.calls[0][0].rpe).toBeUndefined();
  });

  it('attaches the engine key to the row before the upload reads it, so the server id reaches the row', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockAttachEngineActivity.mockResolvedValue({
      id: 'rec-1',
      uploadStatus: 'pending',
      engineActivityId: 'local-deadbeef',
    });
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockAttachEngineActivity).toHaveBeenCalledWith('rec-1', 'local-deadbeef');
    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
    expect(mockAttachEngineActivity.mock.invocationCallOrder[0]).toBeLessThan(
      mockUploadRecording.mock.invocationCallOrder[0]
    );
  });

  it('uploads anyway when no provisional row could be written', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockWriteProvisional.mockResolvedValue(null);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockAttachEngineActivity).not.toHaveBeenCalled();
    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
  });

  /**
   * Scenario: the engine runs the whole upload and answers with one outcome.
   *
   * Expected behaviour: the screen's branch is the one that outcome names,
   * whatever it is, and nothing else decides it.
   */
  it.each([
    [UploadOutcome.Uploaded, { home: true, queued: false, error: false, retry: false, fix: false }],
    [
      UploadOutcome.PermissionBlocked,
      { home: false, queued: false, error: true, retry: false, fix: true },
    ],
    [UploadOutcome.Rejected, { home: false, queued: false, error: true, retry: false, fix: false }],
    [UploadOutcome.Missing, { home: false, queued: false, error: true, retry: false, fix: false }],
    [
      UploadOutcome.AuthExpired,
      { home: true, queued: true, error: false, retry: false, fix: false },
    ],
    [
      UploadOutcome.OtherAthlete,
      { home: true, queued: true, error: false, retry: false, fix: false },
    ],
    [UploadOutcome.Network, { home: true, queued: true, error: false, retry: false, fix: false }],
    [UploadOutcome.Retriable, { home: true, queued: true, error: false, retry: false, fix: false }],
    [
      UploadOutcome.NotStarted,
      { home: true, queued: true, error: false, retry: false, fix: false },
    ],
  ])('follows the outcome the upload export answered (%s)', async (outcome, expected) => {
    mockUploadRecording.mockResolvedValue({ outcome, errorDetail: 'detail from the engine' });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockUploadRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
    expect((router.dismissTo as jest.Mock).mock.calls.length > 0).toBe(expected.home);
    expect((showNotice as jest.Mock).mock.calls.length > 0).toBe(expected.queued);
    expect(result.current.errorMessage !== null).toBe(expected.error);
    expect(result.current.canRetry).toBe(expected.retry);
    expect(result.current.showPermissionFix).toBe(expected.fix);
    expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(
      outcome === UploadOutcome.Uploaded ? 1 : 0
    );
  });
});

it('clips laps to the saved GPS window and rebases their indices and clock', async () => {
  const sliced = {
    ...STREAMS,
    time: [25, 30, 40],
    distance: [50, 100, 200],
    heartrate: [NaN, 140, 160],
  };
  const lap = {
    index: 0,
    startTime: 0,
    endTime: 30,
    startIndex: 0,
    endIndex: 1,
    movingEndTime: 30,
    distance: 100,
    avgSpeed: 100 / 30,
    avgHeartrate: 70,
    avgPower: null,
    avgCadence: null,
  };
  mockSaveRecording.mockResolvedValue(ENTRY);
  const { result } = await renderHook(() =>
    useReviewSave(makeArgs({ canTrim: true, getTrimmedStreams: () => sliced, laps: [lap] }))
  );
  await act(async () => {
    await result.current.handleSave();
  });
  expect(mockGenerateFit.mock.calls[0][0].laps).toEqual([
    expect.objectContaining({
      startTime: 0,
      endTime: 5,
      distance: 50,
      avgSpeed: 10,
      avgHeartrate: 140,
    }),
  ]);
});

it('drops a lap the trim removes and reads the next one from its own samples', async () => {
  const sliced = {
    ...STREAMS,
    time: [25, 35, 45],
    distance: [200, 300, 400],
    heartrate: [150, 0, 170],
  };
  const lap = (index: number, startTime: number, endTime: number, from: number, to: number) => ({
    index,
    startTime,
    endTime,
    startIndex: from,
    endIndex: to,
    movingEndTime: endTime,
    distance: 999,
    avgSpeed: 999,
    avgHeartrate: 999,
    avgPower: null,
    avgCadence: null,
  });
  mockSaveRecording.mockResolvedValue(ENTRY);
  const { result } = await renderHook(() =>
    useReviewSave(
      makeArgs({
        canTrim: true,
        getTrimmedStreams: () => sliced,
        trimStartIndex: 2,
        laps: [lap(0, 0, 20, 0, 1), lap(1, 20, 50, 2, 4)],
      })
    )
  );
  await act(async () => {
    await result.current.handleSave();
  });
  expect(mockGenerateFit.mock.calls[0][0].laps).toEqual([
    expect.objectContaining({
      index: 0,
      startTime: 0,
      endTime: 20,
      startIndex: 0,
      endIndex: 2,
      distance: 200,
      avgSpeed: 10,
      avgHeartrate: 160,
    }),
  ]);
});

describe('the save haptic', () => {
  const successes = () => (haptics.success as jest.Mock).mock.calls.length;

  it('plays one success once the library holds the ride, before it leaves the review', async () => {
    let successesAtLeave = -1;
    (router.dismissTo as jest.Mock).mockImplementationOnce(() => {
      successesAtLeave = successes();
    });
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(successes()).toBe(1);
    expect(successesAtLeave).toBe(1);
  });

  it('plays one success for a saved manual entry', async () => {
    useRecordingStore.setState({ status: 'recording', mode: 'manual' });
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = await renderHook(() => useReviewSave(makeArgs({ isManual: true })));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(successes()).toBe(1);
  });

  it('plays nothing when the library save fails', async () => {
    mockSaveRecording.mockResolvedValue(null);

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(successes()).toBe(0);
  });

  it('plays no second success when a failed upload is retried', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected, errorDetail: 'x' });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(successes()).toBe(1);
  });

  it('plays nothing for a ride the library already held', async () => {
    useRecordingStore.setState({ savedToLibrary: true });

    const { result } = await renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).not.toHaveBeenCalled();
    expect(successes()).toBe(0);
  });
});
