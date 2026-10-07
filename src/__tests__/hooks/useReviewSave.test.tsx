/**
 * Orchestration tests for useReviewSave - the local-save-first save flow.
 *
 * Scenario: saving a GPS recording must persist to the library before any
 * upload attempt, clear the crash backup only after the library save
 * succeeds, and never create a duplicate entry on retry.
 */

import { renderHook, act } from '@testing-library/react-native';
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
import type { RecordingStreams } from '@/features/recording/types';

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

jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({
    upgradePermissions: jest.fn(),
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

const mockRequestSyncRefresh = requestSyncRefresh as jest.Mock;
const mockSaveRecording = saveRecording as jest.Mock;
const mockAttachEngineActivity = attachEngineActivity as jest.Mock;
const mockWriteProvisional = writeProvisionalActivity as jest.Mock;
const mockUploadRecording = uploadRecordingNow as jest.Mock;
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
  // finishAndGoHome defers navigation 1.5s to show the queued toast; run it
  // inline so the suite leaves no open timer handles.
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

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).not.toHaveBeenCalled();
    expect(mockGenerateFit).not.toHaveBeenCalled();
  });

  it("does not save another athlete's stopped ride during a pending handoff", async () => {
    useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
    useRecordingStore.setState({ status: 'stopped', athleteId: 'athlete-a' });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
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
      .mockResolvedValueOnce({ outcome: UploadOutcome.Rejected, errorDetail: 'bad file' })
      .mockResolvedValueOnce({ outcome: UploadOutcome.Uploaded });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.canRetry).toBe(true);
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);

    await act(() => result.current.handleSave());
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledTimes(2);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('explains the missing permission and offers the OAuth fix on 403', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.PermissionBlocked });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBe('recording.permissionExplanation');
    expect(result.current.showPermissionFix).toBe(true);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('treats network failure as saved-and-queued, not an error', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.errorMessage).toBeNull();
    expect(result.current.queuedMessage).not.toBeNull();
  });

  it('finishes a saved recording when its upload needs a fresh sign-in', async () => {
    useRecordingStore.setState({ status: 'stopped' });
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.AuthExpired });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(result.current.isUploading).toBe(false);
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.queuedMessage).not.toBeNull();
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  });

  it.each([new Date(2026, 8, 23, 7, 30).getTime(), 0, null])(
    'saves a manual entry with the same local start as its provisional activity (%s)',
    async (startTime) => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 24, 1));
      mockSaveRecording.mockImplementation(async (params) => ({ ...params, id: 'manual-1' }));
      mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
      useRecordingStore.setState({ status: 'recording', mode: 'manual' });
      const { result } = renderHook(() => useReviewSave(makeArgs({ isManual: true, startTime })));

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

    const { result } = renderHook(() =>
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

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(1);
  });

  it('still goes home when the post-upload sync request throws', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
    mockRequestSyncRefresh.mockImplementationOnce(() => {
      throw new Error('engine gone');
    });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('requests no sync when the upload fails', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockRequestSyncRefresh).not.toHaveBeenCalled();
  });

  it('writes the provisional engine row from the saved FIT, and keeps no streams copy', async () => {
    mockSaveRecording.mockResolvedValue(ENTRY);
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = renderHook(() => useReviewSave(makeArgs()));
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

    const { result } = renderHook(() => useReviewSave(makeArgs({ notes: 'legs heavy', rpe: 8 })));
    await act(() => result.current.handleSave());

    expect(mockSaveRecording).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'legs heavy', rpe: 8 })
    );
  });

  it('saves no effort when the slider was never moved', async () => {
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });

    const { result } = renderHook(() => useReviewSave(makeArgs({ rpe: null })));
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

    const { result } = renderHook(() => useReviewSave(makeArgs()));
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

    const { result } = renderHook(() => useReviewSave(makeArgs()));
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
    [UploadOutcome.Rejected, { home: false, queued: false, error: true, retry: true, fix: false }],
    [UploadOutcome.Missing, { home: false, queued: false, error: true, retry: true, fix: false }],
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

    const { result } = renderHook(() => useReviewSave(makeArgs()));
    await act(() => result.current.handleSave());

    expect(mockUploadRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
    expect((router.replace as jest.Mock).mock.calls.length > 0).toBe(expected.home);
    expect(result.current.queuedMessage !== null).toBe(expected.queued);
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
  const { result } = renderHook(() =>
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
  const { result } = renderHook(() =>
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
