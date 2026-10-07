/**
 * Scenario: a stopped ride reaches the library, and a sign-out lands before the
 * review screen lets go of it: the confirmed 401 of its own upload, an
 * explicit sign-out inside the queued toast, or one while the library write is
 * still in flight. Or the process dies between the library write and the
 * backup delete, the library cannot be read, another athlete signs in before
 * the write lands, or the athlete leaves a review whose upload failed or whose
 * write is still in flight.
 *
 * Expected behaviour: the ride is saved once, stamped with its own athlete. The
 * sign-out holds nothing, the next launch or sign-in opens no review of it, no
 * second library entry is written, and nothing is left stopped to return to.
 */

import { Alert } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import { UploadOutcome } from 'veloqrs';

import { useReviewSave } from '@/features/recording/hooks/useReviewSave';
import {
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from '@/features/recording/lib/holdRecordingOnSignOut';
import { promptInterruptedRecording } from '@/features/recording/lib/interruptedRecording';
import { resumeRecordingBackup } from '@/features/recording/lib/restoreRecordingBackup';
import { sessionReturnRoute } from '@/features/recording/lib/sessionReturnRoute';
import {
  buildRecordingBackup,
  loadRecordingBackup,
  saveRecordingBackup,
} from '@/features/recording/lib/storage/recordingBackup';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import type { RecordingStreams } from '@/features/recording/types';
import type { RecordingLibraryEntry } from '@/types';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    const content = mockFiles.get(from);
    if (content === undefined) throw new Error('ENOENT');
    mockFiles.set(to, content);
    mockFiles.delete(from);
  }),
  writeAsStringAsync: jest.fn(async (path: string, data: string) => {
    mockFiles.set(path, data);
  }),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('@/features/recording/lib/fitGenerator', () => ({
  generateFitFile: jest.fn(async () => new ArrayBuffer(64)),
}));

const mockLibraryRows: Partial<RecordingLibraryEntry>[] = [];
let mockLibraryUnreadable = false;
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  saveRecording: jest.fn(),
  attachEngineActivity: jest.fn(async () => null),
  holdsRecordingStartingIn: jest.fn((from: number, to: number) => {
    if (mockLibraryUnreadable) throw new Error('engine not ready');
    return mockLibraryRows.some(
      (row) => row.kind !== 'manual' && row.startTime! >= from && row.startTime! <= to
    );
  }),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  writeProvisionalActivity: jest.fn(async () => null),
}));

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

jest.mock('@/features/auth', () => ({
  isOAuthConfigured: () => true,
}));

jest.mock('@/features/recording/hooks/usePermissionUpgrade', () => ({
  usePermissionUpgrade: () => ({ upgradePermissions: jest.fn(), isUpgrading: false }),
}));

const mockSaveRecording = saveRecording as jest.Mock;

/** A library row as `saveRecording` writes it: stamped with the ride's athlete. */
function libraryRow(
  startTime: number,
  kind: 'fit' | 'manual' = 'fit',
  athleteId: string | null = useAuthStore.getState().athleteId
) {
  const row = {
    id: `rec-${mockLibraryRows.length + 1}`,
    kind,
    startTime,
    uploadStatus: 'pending' as const,
    ...(athleteId ? { athleteId } : {}),
  };
  mockLibraryRows.push(row);
  return row;
}
const mockUploadRecording = uploadRecordingNow as jest.Mock;

const START = 1_700_000_000_000;
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

const reviewArgs = {
  isManual: false,
  type: 'Ride' as const,
  name: 'Morning Ride',
  summary: { duration: 2, distance: 16, avgHeartrate: 130, elevationGain: 2 },
  notes: '',
  startTime: START,
  pausedSecondsInWindow: 0,
  laps: [],
  pairedEventId: null,
  getTrimmedStreams: () => STREAMS,
  canTrim: false,
  trimStartIndex: 0,
};

function signIn(athleteId: string) {
  useAuthStore.setState({ athleteId, isAuthenticated: true });
}

function signOut() {
  useAuthStore.setState({ athleteId: null, isAuthenticated: false });
}

/** A ride stopped the way the stop handler leaves it: in the store and in the backup. */
async function stopRide(athleteId: string) {
  useRecordingStore.setState({
    status: 'stopped',
    athleteId,
    activityType: 'Ride',
    mode: 'gps',
    startTime: START,
    stopTime: START + 2000,
    streams: STREAMS,
  });
  const backup = buildRecordingBackup(useRecordingStore.getState());
  expect(backup).not.toBeNull();
  expect(await saveRecordingBackup(backup!)).toBe(true);
}

/** What the next sign-in does for the athlete, then a Save on the review it opens. */
async function signInAndSaveAnyReview(athleteId: string) {
  signIn(athleteId);
  const route = await resumeHeldRecordingForAthlete(athleteId);
  if (route) {
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
  }
  return route;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockFiles.clear();
  mockLibraryRows.length = 0;
  mockLibraryUnreadable = false;
  useRecordingStore.getState().reset();
  signIn('athlete-a');
  mockSaveRecording.mockImplementation(async (params: { startTime: number; athleteId: string }) =>
    libraryRow(params.startTime, 'fit', params.athleteId)
  );
  useRecordingPreferences.setState({ autoUploadEnabled: true });
  useUploadPermissionStore.setState({ hasWritePermission: null, recordingWithoutScope: false });
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not hold or save again a ride whose upload met a rejected credential', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.AuthExpired });
  const review = renderHook(() => useReviewSave(reviewArgs));
  await act(() => review.result.current.handleSave());
  expect(await loadRecordingBackup()).toBeNull();

  // The same 401 parks the sync service, whose expiry signs the athlete out
  // while the toast is still on screen.
  await holdRecordingOnSignOut('athlete-a');
  signOut();
  review.unmount();

  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(await loadRecordingBackup()).toBeNull();
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

it.each([
  ['network', UploadOutcome.Network],
  ['retriable', UploadOutcome.Retriable],
] as const)(
  'does not hold a saved ride on an explicit sign-out inside the %s toast',
  async (_name, outcome) => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome });
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
    expect(review.result.current.queuedMessage).not.toBeNull();

    await holdRecordingOnSignOut('athlete-a');
    signOut();
    review.unmount();
    expect(useRecordingStore.getState().status).toBe('idle');

    expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  }
);

it('does not hold a ride saved on the device alone when the athlete signs out in the toast', async () => {
  useRecordingPreferences.setState({ autoUploadEnabled: false });
  await stopRide('athlete-a');
  const review = renderHook(() => useReviewSave(reviewArgs));
  await act(() => review.result.current.handleSave());
  expect(review.result.current.queuedMessage).not.toBeNull();

  await holdRecordingOnSignOut('athlete-a');
  signOut();
  review.unmount();

  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

it('does not reopen a ride whose library write finished after the sign-out held it', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  let finishSave!: (entry: unknown) => void;
  mockSaveRecording.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const review = renderHook(() => useReviewSave(reviewArgs));
  let saving!: Promise<void>;
  act(() => {
    saving = review.result.current.handleSave();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(finishSave).toBeDefined();

  await holdRecordingOnSignOut('athlete-a');
  signOut();
  await act(async () => {
    finishSave(libraryRow(START));
    await saving;
  });
  review.unmount();

  signIn('athlete-a');
  expect(await loadRecordingBackup()).toBeNull();
  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

it('does not hand a saved ride to its athlete again after another athlete signs in', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });
  const review = renderHook(() => useReviewSave(reviewArgs));
  await act(() => review.result.current.handleSave());
  review.unmount();

  // Signed in as another athlete while the saved ride still sits in the store.
  signIn('athlete-b');
  expect(await resumeHeldRecordingForAthlete('athlete-b')).toBeNull();
  expect(useRecordingStore.getState().status).toBe('idle');
  signOut();

  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

it('still holds a stopped ride that never reached the library', async () => {
  await stopRide('athlete-a');
  mockSaveRecording.mockResolvedValue(null);
  const review = renderHook(() => useReviewSave(reviewArgs));
  await act(() => review.result.current.handleSave());
  expect(review.result.current.canRetry).toBe(true);

  await holdRecordingOnSignOut('athlete-a');
  signOut();
  review.unmount();

  signIn('athlete-a');
  expect(await loadRecordingBackup()).toEqual(
    expect.objectContaining({ athleteId: 'athlete-a', status: 'stopped', startTime: START })
  );
  expect(await resumeHeldRecordingForAthlete('athlete-a')).toBe('/recording/review');
});

it('does not save from a second review of a ride the library already holds', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Network });
  const first = renderHook(() => useReviewSave(reviewArgs));
  await act(() => first.result.current.handleSave());

  const second = renderHook(() => useReviewSave(reviewArgs));
  await act(() => second.result.current.handleSave());
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

it('reopens nothing when the held ride stayed in memory and its save finished after', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  let finishSave!: (entry: unknown) => void;
  mockSaveRecording.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const review = renderHook(() => useReviewSave(reviewArgs));
  let saving!: Promise<void>;
  act(() => {
    saving = review.result.current.handleSave();
  });
  await act(async () => {
    await Promise.resolve();
  });

  const FileSystem = jest.requireMock('expo-file-system/legacy');
  FileSystem.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));
  await holdRecordingOnSignOut('athlete-a');
  expect(useRecordingStore.getState().status).toBe('stopped');
  signOut();
  await act(async () => {
    finishSave(libraryRow(START));
    await saving;
  });
  review.unmount();

  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

describe('a backup that outlived the library save of its ride', () => {
  /** The process died after the library write and before the backup delete. */
  async function killAfterLibraryWrite(rowStart = START, kind: 'fit' | 'manual' = 'fit') {
    await stopRide('athlete-a');
    libraryRow(rowStart, kind);
    useRecordingStore.getState().reset();
  }

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('is not offered at launch, and the backup goes', async () => {
    await killAfterLibraryWrite();
    await promptInterruptedRecording();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('is not reopened by the sign-in resume', async () => {
    await killAfterLibraryWrite();
    signOut();
    expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
    expect(await loadRecordingBackup()).toBeNull();
    expect(mockSaveRecording).not.toHaveBeenCalled();
  });

  it('is not restored by the prompt Resume', async () => {
    await killAfterLibraryWrite();
    expect(await resumeRecordingBackup()).toBeNull();
    expect(useRecordingStore.getState().status).toBe('idle');
  });

  it('is found when the save trimmed the start of the ride', async () => {
    await killAfterLibraryWrite(START + 1000);
    expect(await resumeRecordingBackup()).toBeNull();
    expect(await loadRecordingBackup()).toBeNull();
  });

  it('is offered at launch and kept while the library cannot be read', async () => {
    await killAfterLibraryWrite();
    mockLibraryUnreadable = true;
    await promptInterruptedRecording();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await loadRecordingBackup()).not.toBeNull();
  });

  it('is settled as saved, not written again, when Save finds the library holds it', async () => {
    await killAfterLibraryWrite();
    mockLibraryUnreadable = true;
    expect(await resumeRecordingBackup()).toBe('/recording/review');
    mockLibraryUnreadable = false;

    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());

    expect(mockSaveRecording).not.toHaveBeenCalled();
    expect(mockLibraryRows).toHaveLength(1);
    expect(await loadRecordingBackup()).toBeNull();
    expect(review.result.current.queuedMessage).toBe('recording.savedLocally');
  });

  it('is saved when the library still cannot be read at Save', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
    mockLibraryUnreadable = true;
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  });

  it('is still offered when the library holds only an earlier ride or a manual entry', async () => {
    await killAfterLibraryWrite(START - 3_600_000);
    libraryRow(START + 1000, 'manual');
    await promptInterruptedRecording();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await resumeRecordingBackup()).toBe('/recording/review');
  });
});

it("does not reopen a saved ride held in memory through another athlete's sign-in", async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  let finishSave!: (entry: unknown) => void;
  mockSaveRecording.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const review = renderHook(() => useReviewSave(reviewArgs));
  let saving!: Promise<void>;
  act(() => {
    saving = review.result.current.handleSave();
  });
  await act(async () => {
    await Promise.resolve();
  });

  const FileSystem = jest.requireMock('expo-file-system/legacy');
  FileSystem.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));
  await holdRecordingOnSignOut('athlete-a');
  signOut();
  signIn('athlete-b');
  FileSystem.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));
  expect(await resumeHeldRecordingForAthlete('athlete-b')).toBeNull();
  expect(useRecordingStore.getState().status).toBe('idle');

  await act(async () => {
    finishSave(libraryRow(START));
    await saving;
  });
  review.unmount();
  signOut();

  expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
});

describe('a review left after its upload failed', () => {
  it.each([
    ['rejected', UploadOutcome.Rejected],
    ['missing', UploadOutcome.Missing],
    ['permissionBlocked', UploadOutcome.PermissionBlocked],
  ] as const)(
    'leaves nothing to return to once the athlete goes back after %s',
    async (_name, outcome) => {
      await stopRide('athlete-a');
      mockUploadRecording.mockResolvedValue({ outcome });
      const review = renderHook(() => useReviewSave(reviewArgs));
      await act(() => review.result.current.handleSave());
      expect(review.result.current.errorMessage).not.toBeNull();

      review.unmount();
      expect(sessionReturnRoute(useRecordingStore.getState())).toBeNull();
      expect(useRecordingStore.getState().status).toBe('idle');
    }
  );

  it('still retries the upload from the same review', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValueOnce({ outcome: UploadOutcome.Rejected });
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
    expect(review.result.current.canRetry).toBe(true);

    mockUploadRecording.mockResolvedValueOnce({ outcome: UploadOutcome.Uploaded });
    await act(() => review.result.current.handleSave());
    expect(mockUploadRecording).toHaveBeenCalledTimes(2);
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('settles a second review of it instead of offering a Save that does nothing', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected });
    const first = renderHook(() => useReviewSave(reviewArgs));
    await act(() => first.result.current.handleSave());

    const second = renderHook(() => useReviewSave(reviewArgs));
    await act(() => second.result.current.handleSave());
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    expect(second.result.current.queuedMessage).toBe('recording.savedLocally');
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});

it('stamps a ride whose save finishes after another athlete signs in with its own athlete', async () => {
  await stopRide('athlete-a');
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  let finishSave!: (entry: unknown) => void;
  mockSaveRecording.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      })
  );
  const review = renderHook(() => useReviewSave(reviewArgs));
  let saving!: Promise<void>;
  act(() => {
    saving = review.result.current.handleSave();
  });
  await act(async () => {
    await Promise.resolve();
  });

  await holdRecordingOnSignOut('athlete-a');
  signOut();
  signIn('athlete-b');
  await act(async () => {
    finishSave(libraryRow(START, 'fit', 'athlete-a'));
    await saving;
  });
  review.unmount();

  expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  expect(mockSaveRecording).toHaveBeenCalledWith(
    expect.objectContaining({ athleteId: 'athlete-a' })
  );
  expect(mockUploadRecording).not.toHaveBeenCalled();
});

describe('a saved ride while the library cannot be read', () => {
  it('writes no backup when its athlete signs out with the review still open', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected });
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
    expect(await loadRecordingBackup()).toBeNull();

    mockLibraryUnreadable = true;
    await holdRecordingOnSignOut('athlete-a');
    expect(await loadRecordingBackup()).toBeNull();
    signOut();
    review.unmount();

    expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  });

  it('writes no backup when another athlete signs in while it sits in the store', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected });
    const review = renderHook(() => useReviewSave(reviewArgs));
    await act(() => review.result.current.handleSave());
    expect(useRecordingStore.getState()).toEqual(
      expect.objectContaining({ status: 'stopped', savedToLibrary: true })
    );

    mockLibraryUnreadable = true;
    signIn('athlete-b');
    expect(await resumeHeldRecordingForAthlete('athlete-b')).toBeNull();
    expect(useRecordingStore.getState().status).toBe('idle');
    expect(await loadRecordingBackup()).toBeNull();
    review.unmount();
    signOut();

    expect(await signInAndSaveAnyReview('athlete-a')).toBeNull();
    expect(mockSaveRecording).toHaveBeenCalledTimes(1);
  });
});

describe('a review left while its library write is in flight', () => {
  async function leaveReviewMidSave(outcome: UploadOutcome) {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome });
    let finishSave!: (entry: unknown) => void;
    mockSaveRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    const review = renderHook(() => useReviewSave(reviewArgs));
    let saving!: Promise<void>;
    act(() => {
      saving = review.result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    review.unmount();
    expect(useRecordingStore.getState().status).toBe('stopped');
    await act(async () => {
      finishSave(libraryRow(START));
      await saving;
    });
  }

  it.each([
    ['rejected', UploadOutcome.Rejected],
    ['missing', UploadOutcome.Missing],
    ['permissionBlocked', UploadOutcome.PermissionBlocked],
  ] as const)(
    'leaves nothing to return to once the save finishes and the upload is %s',
    async (_name, outcome) => {
      await leaveReviewMidSave(outcome);
      expect(useRecordingStore.getState().status).toBe('idle');
      expect(sessionReturnRoute(useRecordingStore.getState())).toBeNull();
      expect(await loadRecordingBackup()).toBeNull();
      expect(mockSaveRecording).toHaveBeenCalledTimes(1);
    }
  );

  it('still makes the upload the save started', async () => {
    await leaveReviewMidSave(UploadOutcome.Rejected);
    expect(mockUploadRecording).toHaveBeenCalledTimes(1);
    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1');
  });

  it('leaves another ride started meanwhile alone', async () => {
    await stopRide('athlete-a');
    mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Rejected });
    let finishSave!: (entry: unknown) => void;
    mockSaveRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    const review = renderHook(() => useReviewSave(reviewArgs));
    let saving!: Promise<void>;
    act(() => {
      saving = review.result.current.handleSave();
    });
    await act(async () => {
      await Promise.resolve();
    });
    review.unmount();
    useRecordingStore.setState({
      status: 'stopped',
      athleteId: 'athlete-a',
      mode: 'gps',
      startTime: START + 60_000,
      savedToLibrary: true,
    });
    await act(async () => {
      finishSave(libraryRow(START));
      await saving;
    });
    expect(useRecordingStore.getState()).toEqual(
      expect.objectContaining({ status: 'stopped', startTime: START + 60_000 })
    );
  });
});
