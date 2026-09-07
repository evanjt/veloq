/**
 * Scenario: a recording uploads to intervals.icu and the server answers 200.
 *
 * Expected behaviour: nothing on the device is deleted yet. A 200 says the
 * bytes were taken, not that the activity is there, and the FIT is the only
 * other copy of the ride. The recording goes when a later pass has read the
 * activity back, and only then: a 404, a network failure, a dead credential
 * and a signed-out athlete all leave both the row and the files alone.
 */

import { uploadActivityFile } from '@/features/recording/lib/upload/intervalsUploads';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  confirmAndDeleteUploaded,
  verdictFor,
} from '@/features/recording/lib/upload/confirmUploads';
import {
  recordingFitExists,
  discardRecordingFit,
  discardRecordingStreams,
  deleteRecording,
  listRecordings,
} from '@/features/recording/lib/storage/recordingLibrary';
import { useAuthStore } from '@/shared/app/AuthStore';
import { engine, CallKind } from 'veloqrs';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadActivityFile: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  recordProvisionalUpload: jest.fn(async () => true),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingFitExists: jest.fn(),
  readRecordingFit: jest.fn(),
  discardRecordingFit: jest.fn().mockResolvedValue(undefined),
  discardRecordingStreams: jest.fn().mockResolvedValue(undefined),
  deleteRecording: jest.fn().mockResolvedValue(undefined),
  listRecordings: jest.fn().mockResolvedValue([]),
  markRecordingUploading: jest.fn().mockResolvedValue(undefined),
  markRecordingUploaded: jest.fn().mockResolvedValue(undefined),
  markRecordingUploadFailed: jest.fn().mockResolvedValue(undefined),
  markRecordingRejected: jest.fn().mockResolvedValue(undefined),
  markRecordingPermissionBlocked: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: jest.fn() },
}));

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: {
      importSetsFromFit: jest.fn(),
      confirmActivityUploaded: jest.fn(),
    },
  })
);

const mockUpload = uploadActivityFile as jest.Mock;
const mockExists = recordingFitExists as jest.Mock;
const mockDiscardFit = discardRecordingFit as jest.Mock;
const mockDiscardStreams = discardRecordingStreams as jest.Mock;
const mockDelete = deleteRecording as jest.Mock;
const mockList = listRecordings as jest.Mock;
const mockConfirm = engine.confirmActivityUploaded as jest.Mock;
const mockAuth = useAuthStore.getState as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  fitPath: 'file:///recordings/rec-1.fit',
  streamsPath: 'file:///recordings/rec-1.streams.json',
  engineActivityId: 'local-1',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: Date.parse('2026-03-08T06:30:00Z'),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  createdAt: Date.parse('2026-03-08T07:30:00Z'),
  uploadStatus: 'pending',
  retryCount: 0,
};

const UPLOADED: RecordingLibraryEntry = {
  ...ENTRY,
  uploadStatus: 'uploaded',
  intervalsActivityId: 'i12345',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockList.mockResolvedValue([]);
  mockAuth.mockReturnValue({ isAuthenticated: true, isDemoMode: false });
});

describe('the upload itself deletes nothing', () => {
  it('keeps the FIT after a 200, because a 200 is not a confirmation', async () => {
    mockUpload.mockResolvedValue('i12345');

    const result = await uploadRecording(ENTRY);

    expect(result.outcome).toBe('uploaded');
    expect(mockDiscardFit).not.toHaveBeenCalled();
  });

  it('keeps the streams sidecar too, even with the engine holding the track', async () => {
    mockUpload.mockResolvedValue('i12345');

    await uploadRecording(ENTRY);

    expect(mockDiscardStreams).not.toHaveBeenCalled();
  });
});

describe('verdictFor', () => {
  it('reads Ok as present', () => {
    expect(verdictFor({ kind: CallKind.Ok, message: 'ok' })).toBe('present');
  });

  it('reads a 404 as gone, and nothing else does', () => {
    expect(verdictFor({ kind: CallKind.Http, status: 404, message: 'not found' })).toBe('gone');
    expect(verdictFor({ kind: CallKind.Http, status: 500, message: 'server' })).toBe('unknown');
  });

  it('reads a network failure and a dead credential as unknown', () => {
    expect(verdictFor({ kind: CallKind.Network, message: 'offline' })).toBe('unknown');
    expect(verdictFor({ kind: CallKind.Unauthorized, status: 401, message: 'no' })).toBe('unknown');
  });
});

describe('the confirmation pass', () => {
  it('deletes the recording once the activity reads back', async () => {
    mockList.mockResolvedValue([UPLOADED]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Ok, id: 'i12345', message: 'ok' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(1);

    expect(mockConfirm).toHaveBeenCalledWith('i12345');
    expect(mockDelete).toHaveBeenCalledWith('rec-1');
  });

  it('keeps everything when the activity is not there', async () => {
    mockList.mockResolvedValue([UPLOADED]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Http, status: 404, message: 'not found' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps everything when the network could not answer', async () => {
    mockList.mockResolvedValue([UPLOADED]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Network, message: 'offline' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('asks nothing at all with nobody signed in', async () => {
    mockList.mockResolvedValue([UPLOADED]);
    mockAuth.mockReturnValue({ isAuthenticated: false, isDemoMode: false });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('asks nothing in demo mode, which has no upstream account', async () => {
    mockList.mockResolvedValue([UPLOADED]);
    mockAuth.mockReturnValue({ isAuthenticated: true, isDemoMode: true });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);

    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('leaves a recording that never got an id alone', async () => {
    mockList.mockResolvedValue([{ ...ENTRY, uploadStatus: 'uploaded' }]);

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);

    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('leaves one entry failing without stopping the pass', async () => {
    mockList.mockResolvedValue([
      { ...UPLOADED, id: 'rec-1', intervalsActivityId: 'i1' },
      { ...UPLOADED, id: 'rec-2', intervalsActivityId: 'i2' },
    ]);
    mockConfirm
      .mockRejectedValueOnce(new Error('engine closed'))
      .mockResolvedValueOnce({ kind: CallKind.Ok, id: 'i2', message: 'ok' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(1);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('rec-2');
  });

  it('is the regression this exists for: a lost upload stays recoverable', async () => {
    mockUpload.mockResolvedValue('i12345');
    await uploadRecording(ENTRY);

    mockList.mockResolvedValue([UPLOADED]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Http, status: 404, message: 'not found' });
    await confirmAndDeleteUploaded();

    expect(mockDiscardFit).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
