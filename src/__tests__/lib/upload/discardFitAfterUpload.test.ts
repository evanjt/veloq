/**
 * Scenario: a recording uploads successfully to intervals.icu.
 *
 * Expected behaviour: the FIT file goes. It exists to be uploaded, and the copy
 * on intervals.icu is the one that lasts, so keeping it grows the device by
 * every ride the athlete has ever recorded. It must not go one step too early:
 * the strength-set import reads the same bytes after the upload returns, so a
 * WeightTraining recording that loses its FIT before that runs imports nothing
 * and says nothing about it.
 */

import { uploadActivityFile } from '@/features/recording/lib/upload/intervalsUploads';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  recordingFitExists,
  markRecordingUploaded,
  discardRecordingFit,
  readRecordingFit,
} from '@/features/recording/lib/storage/recordingLibrary';
import { engine } from 'veloqrs';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadActivityFile: jest.fn(),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingFitExists: jest.fn(),
  readRecordingFit: jest.fn(),
  discardRecordingFit: jest.fn().mockResolvedValue(undefined),
  markRecordingUploading: jest.fn().mockResolvedValue(undefined),
  markRecordingUploaded: jest.fn().mockResolvedValue(undefined),
  markRecordingUploadFailed: jest.fn().mockResolvedValue(undefined),
  markRecordingRejected: jest.fn().mockResolvedValue(undefined),
  markRecordingPermissionBlocked: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('veloqrs', () => ({ engine: { importSetsFromFit: jest.fn() } }));

const mockUpload = uploadActivityFile as jest.Mock;
const mockExists = recordingFitExists as jest.Mock;
const mockDiscard = discardRecordingFit as jest.Mock;
const mockReadFit = readRecordingFit as jest.Mock;
const mockImportSets = engine.importSetsFromFit as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  fitPath: 'file:///recordings/rec-1.fit',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: Date.parse('2026-03-08T06:30:00Z'),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  createdAt: Date.parse('2026-03-08T07:30:00Z'),
  uploadStatus: 'pending',
  retryCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
});

describe('the FIT file is discarded once the upload is done with it', () => {
  it('deletes the FIT after a successful upload', async () => {
    mockUpload.mockResolvedValue('i12345');
    const result = await uploadRecording(ENTRY);
    expect(result.outcome).toBe('uploaded');
    expect(mockDiscard).toHaveBeenCalledWith(ENTRY.id);
  });

  it('deletes it after the strength import has read it, not before', async () => {
    const order: string[] = [];
    mockUpload.mockResolvedValue('i12345');
    mockReadFit.mockImplementation(async () => {
      order.push('read');
      return new ArrayBuffer(8);
    });
    mockImportSets.mockImplementation(() => {
      order.push('import');
      return 3;
    });
    mockDiscard.mockImplementation(async () => {
      order.push('discard');
    });
    await uploadRecording({ ...ENTRY, activityType: 'WeightTraining' });
    expect(order).toEqual(['read', 'import', 'discard']);
  });

  it('keeps the FIT when the upload fails, at every outcome', async () => {
    for (const err of [
      { status: 403 },
      { status: 422 },
      { status: 500 },
      new Error('network down'),
    ]) {
      mockUpload.mockRejectedValue(err);
      const result = await uploadRecording(ENTRY);
      expect(result.outcome).not.toBe('uploaded');
      expect(mockDiscard).not.toHaveBeenCalled();
    }
  });

  it('keeps the FIT when the file was already missing', async () => {
    mockExists.mockResolvedValue(false);
    const result = await uploadRecording(ENTRY);
    expect(result.outcome).toBe('missing');
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(markRecordingUploaded).not.toHaveBeenCalled();
  });

  it('still reports the upload as done when the delete itself fails', async () => {
    mockUpload.mockResolvedValue('i12345');
    mockDiscard.mockRejectedValue(new Error('storage busy'));
    await expect(uploadRecording(ENTRY)).resolves.toEqual({ outcome: 'uploaded' });
  });
});
