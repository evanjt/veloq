/**
 * Scenario: a saved recording is pushed to intervals.icu and the server
 * responds in every way it realistically can.
 *
 * Expected behaviour: each failure lands the library entry in the state that
 * matches what the user can do about it. A transient failure must stay
 * retriable, a 403 must route to the permission upgrade, and a hard rejection
 * must never be silently re-queued. No failure outcome deletes the FIT file;
 * that a success does is `discardFitAfterUpload.test.ts`.
 */

import { uploadActivityFile } from '@/features/recording/lib/upload/intervalsUploads';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import {
  recordingFitExists,
  markRecordingUploading,
  markRecordingUploaded,
  markRecordingUploadFailed,
  markRecordingRejected,
  markRecordingPermissionBlocked,
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
  markRecordingUploading: jest.fn().mockResolvedValue(undefined),
  markRecordingUploaded: jest.fn().mockResolvedValue(undefined),
  markRecordingUploadFailed: jest.fn().mockResolvedValue(undefined),
  markRecordingRejected: jest.fn().mockResolvedValue(undefined),
  markRecordingPermissionBlocked: jest.fn().mockResolvedValue(undefined),
  discardRecordingFit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('veloqrs', () => ({
  engine: { importSetsFromFit: jest.fn() },
}));

const mockUpload = uploadActivityFile as jest.Mock;
const mockExists = recordingFitExists as jest.Mock;
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

const STRENGTH_ENTRY: RecordingLibraryEntry = {
  ...ENTRY,
  id: 'rec-strength',
  activityType: 'WeightTraining',
  name: 'Lower body',
  fitPath: 'file:///recordings/rec-strength.fit',
  distanceMeters: 0,
};

/**
 * The engine reports a refused write as an outcome carried on the thrown
 * error, so the queue branches on a status rather than on a message.
 */
function refused(kind: string, status?: number, detail?: string, message?: string) {
  return Object.assign(new Error(message ?? `HTTP ${status ?? '?'}: ${detail ?? ''}`), {
    outcome: { kind, status, detail, message: message ?? `HTTP ${status ?? '?'}: ${detail ?? ''}` },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockUpload.mockResolvedValue('i999');
  mockReadFit.mockResolvedValue(new Uint8Array([0x0e, 0x10, 0x2e, 0x46]).buffer);
  mockImportSets.mockReturnValue(3);
});

describe('uploadRecording', () => {
  it('uploads the FIT and marks the entry uploaded', async () => {
    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(mockUpload).toHaveBeenCalledWith('file:///recordings/rec-1.fit', 'Morning Ride.fit', {
      name: 'Morning Ride',
      pairedEventId: undefined,
    });
    expect(markRecordingUploading).toHaveBeenCalledWith('rec-1');
    expect(markRecordingUploaded).toHaveBeenCalledWith('rec-1', 'i999');
  });

  it('forwards a paired calendar event', async () => {
    await uploadRecording({ ...ENTRY, pairedEventId: 4321 });

    expect(mockUpload).toHaveBeenCalledWith('file:///recordings/rec-1.fit', 'Morning Ride.fit', {
      name: 'Morning Ride',
      pairedEventId: 4321,
    });
  });

  it('uploads from the path on disk without reading the file', async () => {
    await uploadRecording(ENTRY);

    const [path] = mockUpload.mock.calls[0];
    expect(path).toBe(ENTRY.fitPath);
  });

  it('rejects the entry when the FIT file is gone', async () => {
    mockExists.mockResolvedValue(false);

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'missing' });
    expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'FIT file missing on device');
    expect(mockUpload).not.toHaveBeenCalled();
    expect(markRecordingUploading).not.toHaveBeenCalled();
  });

  it('routes a 403 to the permission upgrade path', async () => {
    mockUpload.mockRejectedValue(refused('http', 403, 'write scope required'));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'permissionBlocked' });
    expect(markRecordingPermissionBlocked).toHaveBeenCalledWith('rec-1');
    expect(markRecordingUploadFailed).not.toHaveBeenCalled();
    expect(markRecordingRejected).not.toHaveBeenCalled();
  });

  it('queues a network failure for a later attempt', async () => {
    mockUpload.mockRejectedValue(
      refused('network', undefined, undefined, 'transport error: connection reset')
    );

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({
      outcome: 'network',
      errorDetail: 'transport error: connection reset',
    });
    expect(markRecordingUploadFailed).toHaveBeenCalledWith(
      'rec-1',
      'transport error: connection reset'
    );
  });

  it('surfaces the server message on a hard rejection', async () => {
    mockUpload.mockRejectedValue(refused('http', 400, 'Corrupt FIT file'));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'rejected', errorDetail: 'Corrupt FIT file' });
    expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'Corrupt FIT file');
    expect(markRecordingUploadFailed).not.toHaveBeenCalled();
  });

  describe('retriable status mapping', () => {
    const retriable = [408, 429, 500, 502, 503, 504];
    const terminal = [400, 401, 404, 409, 413, 422];

    it.each(retriable)('keeps %s retriable', async (status) => {
      mockUpload.mockRejectedValue(refused('http', status, 'try again'));

      const result = await uploadRecording(ENTRY);

      expect(result.outcome).toBe('retriable');
      expect(markRecordingUploadFailed).toHaveBeenCalledWith('rec-1', 'try again');
    });

    it.each(terminal)('treats %s as a rejection', async (status) => {
      mockUpload.mockRejectedValue(refused('http', status, 'no'));

      const result = await uploadRecording(ENTRY);

      expect(result.outcome).toBe('rejected');
      expect(markRecordingRejected).toHaveBeenCalledWith('rec-1', 'no');
    });
  });

  it('treats a rejected credential as terminal, not as something to retry', async () => {
    mockUpload.mockRejectedValue(refused('unauthorized', 401, undefined, 'unauthorized (401)'));

    const result = await uploadRecording(ENTRY);

    expect(result.outcome).toBe('rejected');
  });

  it('keeps a rate-limited upload retriable', async () => {
    mockUpload.mockRejectedValue(
      refused('rateLimited', 429, undefined, 'rate limited (429) after retries')
    );

    const result = await uploadRecording(ENTRY);

    expect(result.outcome).toBe('retriable');
  });

  it('keeps a local engine failure retriable rather than calling it offline', async () => {
    mockUpload.mockRejectedValue(
      refused('internal', undefined, undefined, 'the engine is not ready to upload')
    );

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({
      outcome: 'retriable',
      errorDetail: 'the engine is not ready to upload',
    });
  });

  it('treats an error with no recognisable shape as retriable', async () => {
    mockUpload.mockRejectedValue(new Error('something went sideways'));

    const result = await uploadRecording(ENTRY);

    expect(result).toEqual({ outcome: 'retriable', errorDetail: 'something went sideways' });
    expect(markRecordingUploadFailed).toHaveBeenCalledWith('rec-1', 'something went sideways');
  });

  it('falls back to the raw error message when the body carries no detail', async () => {
    mockUpload.mockRejectedValue(refused('http', 422, undefined, 'HTTP 422: '));

    const result = await uploadRecording(ENTRY);

    expect(result.outcome).toBe('rejected');
    expect(result.errorDetail).toBe('HTTP 422: ');
  });

  it('marks the entry uploading before every attempt', async () => {
    mockUpload.mockRejectedValue(refused('http', 500, 'boom'));

    await uploadRecording(ENTRY);

    expect(markRecordingUploading).toHaveBeenCalledWith('rec-1');
  });
});

describe('strength sets from a recorded session', () => {
  it('imports the sets out of the FIT the upload just accepted', async () => {
    const result = await uploadRecording(STRENGTH_ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(mockReadFit).toHaveBeenCalledWith(STRENGTH_ENTRY);
    expect(mockImportSets).toHaveBeenCalledWith('i999', expect.any(Uint8Array));
  });

  it('leaves a ride alone, which has no sets to import', async () => {
    await uploadRecording(ENTRY);

    expect(mockImportSets).not.toHaveBeenCalled();
    expect(mockReadFit).not.toHaveBeenCalled();
  });

  it('skips the import when the server named no activity to key the sets to', async () => {
    mockUpload.mockResolvedValue(undefined);

    const result = await uploadRecording(STRENGTH_ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(mockImportSets).not.toHaveBeenCalled();
  });

  it('skips the import when the FIT can no longer be read', async () => {
    mockReadFit.mockResolvedValue(null);

    const result = await uploadRecording(STRENGTH_ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(mockImportSets).not.toHaveBeenCalled();
  });

  it('keeps the upload successful when the import throws', async () => {
    mockImportSets.mockImplementation(() => {
      throw new Error('engine down');
    });

    const result = await uploadRecording(STRENGTH_ENTRY);

    expect(result).toEqual({ outcome: 'uploaded' });
    expect(markRecordingUploaded).toHaveBeenCalledWith('rec-strength', 'i999');
  });

  it('does not import for a failed upload', async () => {
    mockUpload.mockRejectedValue(refused('http', 500, 'server error'));

    await uploadRecording(STRENGTH_ENTRY);

    expect(mockImportSets).not.toHaveBeenCalled();
  });
});
