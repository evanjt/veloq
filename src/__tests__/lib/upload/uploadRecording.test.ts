/**
 * Scenario: a saved recording is pushed to intervals.icu and the server
 * responds in every way it realistically can.
 *
 * Expected behaviour: each failure lands the library entry in the state that
 * matches what the user can do about it. A transient failure must stay
 * retriable, a 403 must route to the permission upgrade, and a hard rejection
 * must never be silently re-queued. The FIT file is never deleted.
 */

jest.mock('@/api', () => ({
  intervalsApi: { uploadActivity: jest.fn() },
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  readRecordingFit: jest.fn(),
  markRecordingUploading: jest.fn().mockResolvedValue(undefined),
  markRecordingUploaded: jest.fn().mockResolvedValue(undefined),
  markRecordingUploadFailed: jest.fn().mockResolvedValue(undefined),
  markRecordingRejected: jest.fn().mockResolvedValue(undefined),
  markRecordingPermissionBlocked: jest.fn().mockResolvedValue(undefined),
}));

import { intervalsApi } from '@/api';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  readRecordingFit,
  markRecordingUploading,
  markRecordingUploaded,
  markRecordingUploadFailed,
  markRecordingRejected,
  markRecordingPermissionBlocked,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

const mockUpload = intervalsApi.uploadActivity as jest.Mock;
const mockRead = readRecordingFit as jest.Mock;

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

const BUFFER = new Uint8Array([1, 2, 3, 4]).buffer;

function axiosLikeError(status: number, data?: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue(BUFFER);
  mockUpload.mockResolvedValue({ id: 'i999' });
});

describe('uploadRecording', () => {
  it('uploads the FIT and marks the entry uploaded', async () => {
    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(mockUpload).toHaveBeenCalledWith(BUFFER, 'Morning Ride.fit', {
      name: 'Morning Ride',
      pairedEventId: undefined,
    });
    expect(markRecordingUploading).toHaveBeenCalledWith('rec-1');
    expect(markRecordingUploaded).toHaveBeenCalledWith('rec-1');
  });

  it('forwards a paired calendar event', async () => {
    await uploadRecording({ ...ENTRY, pairedEventId: 4321 });

    expect(mockUpload).toHaveBeenCalledWith(BUFFER, 'Morning Ride.fit', {
      name: 'Morning Ride',
      pairedEventId: 4321,
    });
  });

  it('uses a caller-supplied buffer instead of reading from disk', async () => {
    const inMemory = new Uint8Array([9, 9]).buffer;

    await uploadRecording(ENTRY, inMemory);

    expect(mockRead).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledWith(inMemory, 'Morning Ride.fit', expect.anything());
  });

  it('rejects the entry when the FIT file is gone', async () => {
    mockRead.mockResolvedValue(null);

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'missing' });
    expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'FIT file missing on device');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(markRecordingUploading).not.toHaveBeenCalled();
  });

  it('routes a 403 to the permission upgrade path', async () => {
    mockUpload.mockRejectedValue(axiosLikeError(403, { message: 'write scope required' }));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'permissionBlocked' });
    expect(markRecordingPermissionBlocked).toHaveBeenCalledWith('rec-1');
    expect(markRecordingUploadFailed).not.toHaveBeenCalled();
    expect(markRecordingRejected).not.toHaveBeenCalled();
  });

  it('queues a network failure for a later attempt', async () => {
    mockUpload.mockRejectedValue(new Error('Network Error'));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'network', errorDetail: 'Network Error' });
    expect(markRecordingUploadFailed).toHaveBeenCalledWith('rec-1', 'Network Error');
  });

  it('surfaces the server message on a hard rejection', async () => {
    mockUpload.mockRejectedValue(axiosLikeError(400, { message: 'Corrupt FIT file' }));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'rejected', errorDetail: 'Corrupt FIT file' });
    expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'Corrupt FIT file');
    expect(markRecordingUploadFailed).not.toHaveBeenCalled();
  });

  describe('retriable status mapping', () => {
    const retriable = [408, 429, 500, 502, 503, 504];
    const terminal = [400, 401, 404, 409, 413, 422];

    it.each(retriable)('keeps %s retriable', async (status) => {
      mockUpload.mockRejectedValue(axiosLikeError(status, { message: 'try again' }));

      const result = await uploadRecording(ENTRY);

      expect(result.outcome).toBe('retriable');
      expect(markRecordingUploadFailed).toHaveBeenCalledWith('rec-1', 'try again');
    });

    it.each(terminal)('treats %s as a rejection', async (status) => {
      mockUpload.mockRejectedValue(axiosLikeError(status, { message: 'no' }));

      const result = await uploadRecording(ENTRY);

      expect(result.outcome).toBe('rejected');
      expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'no');
    });
  });

  it('treats an error with no recognisable shape as retriable', async () => {
    mockUpload.mockRejectedValue(new Error('something went sideways'));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'retriable', errorDetail: 'something went sideways' });
    expect(markRecordingUploadFailed).toHaveBeenCalledWith('rec-1', 'something went sideways');
  });

  it('falls back to the raw error message when the body carries no detail', async () => {
    mockUpload.mockRejectedValue(axiosLikeError(422));

    const result = await uploadRecording(ENTRY);

    expect(result.outcome).toBe('rejected');
    expect(result.errorDetail).toBe('Request failed with status code 422');
  });

  it('marks the entry uploading before every attempt', async () => {
    mockUpload.mockRejectedValue(axiosLikeError(500));

    await uploadRecording(ENTRY);

    expect(markRecordingUploading).toHaveBeenCalledWith('rec-1');
  });
});
