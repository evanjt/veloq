/**
 * Scenario: a manual indoor entry posted straight to intervals.icu and kept no
 * local copy. Offline it failed with a red banner, the review screen offered no
 * retry on that path, and navigating away lost what had been typed.
 *
 * Expected behaviour: a manual entry is a row in the recordings library like any
 * other ride. It saves first and posts second, it drains through the one upload
 * queue, and the upload path never asks whether a FIT it has no reason to have
 * is on disk.
 */

import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  recordingFitExists,
  markRecordingUploaded,
  readRecordingManualBody,
} from '@/features/recording/lib/storage/recordingLibrary';
import {
  createManualActivity,
  uploadActivityFile,
} from '@/features/recording/lib/upload/intervalsUploads';
import { recordProvisionalUpload } from '@/features/recording/lib/storage/provisionalActivity';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: { importSetsFromFit: jest.fn(() => 0) },
  })
);
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadActivityFile: jest.fn(async () => 'i123'),
  createManualActivity: jest.fn(async () => 'i456'),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingFitExists: jest.fn(async () => true),
  readRecordingFit: jest.fn(async () => null),
  readRecordingManualBody: jest.fn(async () => ({
    type: 'VirtualRide',
    name: 'Turbo session',
    start_date_local: '2026-09-14T18:00:00',
    elapsed_time: 2700,
  })),
  markRecordingUploading: jest.fn(async () => undefined),
  markRecordingUploaded: jest.fn(async () => undefined),
  markRecordingUploadFailed: jest.fn(async () => undefined),
  markRecordingRejected: jest.fn(async () => undefined),
  markRecordingPermissionBlocked: jest.fn(async () => undefined),
  holdRecordingForAuth: jest.fn(async () => undefined),
  holdRecordingForNetwork: jest.fn(async () => undefined),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  recordProvisionalUpload: jest.fn(async () => undefined),
}));

function entry(overrides: Partial<RecordingLibraryEntry> = {}): RecordingLibraryEntry {
  return {
    id: 'rec-1',
    kind: 'fit',
    fitPath: '/recordings/rec-1.fit',
    activityType: 'Ride',
    name: 'Evening ride',
    startTime: 1_757_200_000_000,
    durationSeconds: 3600,
    distanceMeters: 28_400,
    createdAt: 1_757_203_600_000,
    uploadStatus: 'pending',
    retryCount: 0,
    ...overrides,
  } as RecordingLibraryEntry;
}

beforeEach(() => jest.clearAllMocks());

describe('uploading a manual entry', () => {
  it('posts the stored body rather than looking for a file', async () => {
    const result = await uploadRecording(
      entry({ kind: 'manual', fitPath: '', streamsPath: '/recordings/rec-1.manual.json' })
    );

    expect(result.outcome).toBe('uploaded');
    expect(recordingFitExists).not.toHaveBeenCalled();
    expect(uploadActivityFile).not.toHaveBeenCalled();
    expect(createManualActivity).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Turbo session' })
    );
    expect(markRecordingUploaded).toHaveBeenCalledWith('rec-1', 'i456');
    expect(recordProvisionalUpload).toHaveBeenCalled();
  });

  it('holds the entry when the body cannot be read, rather than rejecting the ride', async () => {
    (readRecordingManualBody as jest.Mock).mockResolvedValueOnce(null);

    const result = await uploadRecording(entry({ kind: 'manual', fitPath: '' }));

    expect(result.outcome).toBe('missing');
    expect(createManualActivity).not.toHaveBeenCalled();
  });

  it('leaves a recorded ride on the file path it already took', async () => {
    const result = await uploadRecording(entry());

    expect(result.outcome).toBe('uploaded');
    expect(recordingFitExists).toHaveBeenCalled();
    expect(uploadActivityFile).toHaveBeenCalled();
    expect(createManualActivity).not.toHaveBeenCalled();
  });
});
