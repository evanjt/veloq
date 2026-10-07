/**
 * Scenario: athlete A's ride is stamped A and held `localOnly` in the library.
 * Athlete B signs in on the same phone, opens My Recordings and taps Upload on
 * it.
 *
 * Expected behaviour: the screen offers only what the visible read returns, and
 * a ride it offers goes to the engine's one upload export by id. The engine
 * checks the owner and requeues a parked ride itself, so the hook issues no
 * transition and takes no verdict of its own: it answers what the engine said.
 */

import { act, renderHook } from '@testing-library/react-native';
import { UploadOutcome } from 'veloqrs';

import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import {
  getVisibleRecording,
  listVisibleRecordings,
  onRecordingsChanged,
  transitionRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import type { RecordingLibraryEntry } from '@/types';

const A = 'i100';
const B = 'i200';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: jest.fn(),
}));

const mockEngine = {};
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: jest.fn(() => mockEngine),
}));

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listVisibleRecordings: jest.fn(async () => []),
  getVisibleRecording: jest.fn(),
  recordingInstall: jest.fn(() => 3),
  transitionRecording: jest.fn(async () => ({ applied: true, retryCount: 0, install: 3 })),
  deleteRecording: jest.fn(async () => {}),
  onRecordingsChanged: jest.fn(() => () => {}),
  recordingFitExists: jest.fn(async () => true),
  holdRecordingsOfOtherAthletes: jest.fn(async () => {}),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: () => {}, warn: () => {}, error: () => {} }) },
}));

const mockGetVisibleRecording = getVisibleRecording as jest.Mock;
const mockUploadNow = uploadRecordingNow as jest.Mock;

function ride(athleteId: string): RecordingLibraryEntry {
  return {
    id: `rec-${athleteId}`,
    kind: 'fit',
    fitPath: `file:///recordings/rec-${athleteId}.fit`,
    activityType: 'Ride',
    name: 'Morning Ride',
    startTime: Date.parse('2026-09-30T06:30:00Z'),
    durationSeconds: 3600,
    distanceMeters: 28_400,
    createdAt: Date.parse('2026-09-30T07:30:00Z'),
    uploadStatus: 'localOnly',
    retryCount: 0,
    athleteId,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadNow.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
});

async function pressUpload(entry: RecordingLibraryEntry) {
  mockGetVisibleRecording.mockResolvedValue(entry);
  const { result } = renderHook(() => useRecordingLibrary());
  let outcome: Awaited<ReturnType<typeof result.current.uploadNow>> = null;
  await act(async () => {
    outcome = await result.current.uploadNow(entry.id);
  });
  return outcome;
}

describe('Upload in My Recordings', () => {
  it('hands the ride to the one upload export by id and answers its result', async () => {
    const outcome = await pressUpload(ride(B));

    expect(mockUploadNow).toHaveBeenCalledTimes(1);
    expect(mockUploadNow).toHaveBeenCalledWith(`rec-${B}`);
    expect(outcome).toEqual({ outcome: UploadOutcome.Uploaded });
  });

  it("answers the engine refusing another athlete's ride as the engine gave it", async () => {
    mockUploadNow.mockResolvedValue({ outcome: UploadOutcome.OtherAthlete });

    const outcome = await pressUpload(ride(A));

    expect(mockUploadNow).toHaveBeenCalledWith(`rec-${A}`);
    expect(outcome).toEqual({ outcome: UploadOutcome.OtherAthlete });
  });

  it('issues no transition of its own, since the engine requeues a parked ride', async () => {
    await pressUpload(ride(B));

    expect(transitionRecording).not.toHaveBeenCalled();
  });

  it.each(['uploaded', 'uploading'] as const)(
    'answers the engine not starting a ride now %s, with no transition from here',
    async (status) => {
      mockUploadNow.mockResolvedValue({ outcome: UploadOutcome.NotStarted });

      const outcome = await pressUpload({ ...ride(B), uploadStatus: status });

      expect(mockUploadNow).toHaveBeenCalledWith(`rec-${B}`);
      expect(outcome).toEqual({ outcome: UploadOutcome.NotStarted });
      expect(transitionRecording).not.toHaveBeenCalled();
    }
  );

  it('clears the uploading mark and refreshes the list when the export throws', async () => {
    mockUploadNow.mockRejectedValue(new Error('engine closed'));
    mockGetVisibleRecording.mockResolvedValue(ride(B));
    const { result } = renderHook(() => useRecordingLibrary());
    jest.mocked(listVisibleRecordings).mockClear();

    await act(async () => {
      await expect(result.current.uploadNow(`rec-${B}`)).rejects.toThrow('engine closed');
    });

    expect(result.current.uploadingId).toBeNull();
    expect(listVisibleRecordings).toHaveBeenCalledTimes(1);
  });
});

describe('the list in My Recordings', () => {
  it("is the visible read, so another athlete's held ride never reaches the screen", async () => {
    jest.mocked(listVisibleRecordings).mockResolvedValue([ride(B)]);
    const { result } = renderHook(() => useRecordingLibrary());
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.entries.map((e) => e.id)).toEqual([`rec-${B}`]);
    expect(listVisibleRecordings).toHaveBeenCalled();
  });

  it("does not upload a ride the visible read does not return (another athlete's)", async () => {
    mockGetVisibleRecording.mockResolvedValue(null);
    const { result } = renderHook(() => useRecordingLibrary());
    let outcome: Awaited<ReturnType<typeof result.current.uploadNow>> = null;
    await act(async () => {
      outcome = await result.current.uploadNow(`rec-${A}`);
    });

    expect(outcome).toBeNull();
    expect(mockUploadNow).not.toHaveBeenCalled();
    expect(transitionRecording).not.toHaveBeenCalled();
  });
  it('reads the list again when the engine moves a recording, and stops on unmount', async () => {
    jest.mocked(listVisibleRecordings).mockResolvedValue([ride(B)]);
    const off = jest.fn();
    jest.mocked(onRecordingsChanged).mockReturnValue(off);
    const { result, unmount } = renderHook(() => useRecordingLibrary());
    await act(async () => {});
    expect(listVisibleRecordings).not.toHaveBeenCalled();

    const changed = jest.mocked(onRecordingsChanged).mock.calls[0]![0];
    await act(async () => {
      changed();
    });

    expect(listVisibleRecordings).toHaveBeenCalledTimes(1);
    expect(result.current.entries.map((e) => e.id)).toEqual([`rec-${B}`]);
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
