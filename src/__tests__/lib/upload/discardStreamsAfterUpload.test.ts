/**
 * Scenario: a recording uploads successfully and the engine already holds its
 * track under a locally minted key.
 *
 * Expected behaviour: the streams sidecar goes with the FIT. It is a second
 * copy of what the engine holds, and it is the last thing on disk that grows
 * with every ride the athlete records. A recording whose engine write never
 * landed keeps its sidecar, since it is then the only copy of the track.
 */

import { uploadActivityFile } from '@/features/recording/lib/upload/intervalsUploads';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  recordingFitExists,
  discardRecordingStreams,
} from '@/features/recording/lib/storage/recordingLibrary';
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
  markRecordingUploading: jest.fn().mockResolvedValue(undefined),
  markRecordingUploaded: jest.fn().mockResolvedValue(undefined),
  markRecordingUploadFailed: jest.fn().mockResolvedValue(undefined),
  markRecordingRejected: jest.fn().mockResolvedValue(undefined),
  markRecordingPermissionBlocked: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: { importSetsFromFit: jest.fn() },
  })
);

const mockUpload = uploadActivityFile as jest.Mock;
const mockExists = recordingFitExists as jest.Mock;
const mockDiscardStreams = discardRecordingStreams as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  fitPath: 'file:///recordings/rec-1.fit',
  streamsPath: 'file:///recordings/rec-1.streams.json',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: Date.parse('2026-03-08T06:30:00Z'),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  createdAt: Date.parse('2026-03-08T07:30:00Z'),
  uploadStatus: 'pending',
  retryCount: 0,
  engineActivityId: 'local-deadbeef',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockUpload.mockResolvedValue('i12345');
});

describe('the streams sidecar goes once the engine is the copy that lasts', () => {
  it('deletes it after a successful upload', async () => {
    await expect(uploadRecording(ENTRY)).resolves.toEqual({ outcome: 'uploaded' });

    expect(mockDiscardStreams).toHaveBeenCalledWith(ENTRY.id);
  });

  it('keeps it when the recording has no engine row', async () => {
    await uploadRecording({ ...ENTRY, engineActivityId: undefined });

    expect(mockDiscardStreams).not.toHaveBeenCalled();
  });

  it('keeps it at every failing outcome', async () => {
    for (const err of [{ status: 403 }, { status: 422 }, { status: 500 }, new Error('offline')]) {
      mockUpload.mockRejectedValue(err);
      const result = await uploadRecording(ENTRY);
      expect(result.outcome).not.toBe('uploaded');
      expect(mockDiscardStreams).not.toHaveBeenCalled();
    }
  });

  it('still reports the upload as done when the delete throws', async () => {
    mockDiscardStreams.mockRejectedValue(new Error('storage busy'));

    await expect(uploadRecording(ENTRY)).resolves.toEqual({ outcome: 'uploaded' });
  });
});
