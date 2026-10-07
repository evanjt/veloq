/**
 * Scenario: a recording uploaded to intervals.icu and the server answered 200.
 *
 * Expected behaviour: a 200 says the bytes were taken, not that the activity
 * is there, and the FIT is the only other copy of the ride, so the upload
 * deletes nothing (asserted in Rust, where it runs). The recording goes when
 * this pass has read the activity back, and only then: a 404, a network
 * failure, a dead credential and a signed-out athlete all retain the recording
 * and its files.
 */

import {
  confirmAndDeleteUploaded,
  verdictFor,
} from '@/features/recording/lib/upload/confirmUploads';
import {
  recordingFitExists,
  deleteRecording,
  listRecordings,
  transitionRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
import { recordingActions } from '@/features/recording/lib/recordingActions';
import { useAuthStore } from '@/shared/app/AuthStore';
import { engine, CallKind } from 'veloqrs';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingFitExists: jest.fn(),
  deleteRecording: jest.fn().mockResolvedValue(undefined),
  listRecordings: jest.fn().mockResolvedValue([]),
  recordingInstall: jest.fn(() => 3),
  transitionRecording: jest.fn().mockResolvedValue({ applied: true, retryCount: 0, install: 3 }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: jest.fn() },
  getStoredCredentials: () => ({ athleteId: 'i100' }),
}));

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: {
      confirmActivityUploaded: jest.fn(),
    },
  })
);

const mockExists = recordingFitExists as jest.Mock;
const mockDelete = deleteRecording as jest.Mock;
const mockList = listRecordings as jest.Mock;
const mockConfirm = engine.confirmActivityUploaded as jest.Mock;
const mockAuth = useAuthStore.getState as jest.Mock;

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  kind: 'fit',
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
  athleteId: 'i100',
};

const UPLOADED: RecordingLibraryEntry = {
  ...ENTRY,
  uploadStatus: 'uploaded',
  intervalsActivityId: 'i12345',
  engineReconciled: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExists.mockResolvedValue(true);
  mockList.mockResolvedValue([]);
  mockAuth.mockReturnValue({ isAuthenticated: true, isDemoMode: false });
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
  it('retains a confirmed recording until its engine reconcile succeeds', async () => {
    mockList.mockResolvedValue([{ ...UPLOADED, engineReconciled: false }]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Ok, message: 'ok' });
    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();

    mockList.mockResolvedValue([UPLOADED]);
    await expect(confirmAndDeleteUploaded()).resolves.toBe(1);
    expect(mockDelete).toHaveBeenCalledWith(UPLOADED.id);
  });

  /**
   * The effort goes up after the upload, and the row is its only record. A
   * recording deleted while it is owed takes the athlete's effort with it.
   */
  it('retains a confirmed recording until its effort has reached intervals.icu', async () => {
    mockList.mockResolvedValue([{ ...UPLOADED, rpe: 8, rpeSent: false }]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Ok, message: 'ok' });
    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);
    expect(mockDelete).not.toHaveBeenCalled();

    mockList.mockResolvedValue([{ ...UPLOADED, rpe: 8, rpeSent: true }]);
    await expect(confirmAndDeleteUploaded()).resolves.toBe(1);
  });

  it('parks a missing upload even while its effort is still owed', async () => {
    const entry = { ...UPLOADED, rpe: 8, rpeSent: false };
    mockList.mockResolvedValue([entry]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Http, status: 404, message: 'not found' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);
    expect(mockConfirm).toHaveBeenCalledWith(entry.intervalsActivityId);
    expect(transitionRecording).toHaveBeenCalledWith(entry.id, {
      kind: 'rejected',
      install: 3,
      error: expect.stringContaining('intervals.icu'),
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes a confirmed recording with no provisional engine row', async () => {
    mockList.mockResolvedValue([
      { ...UPLOADED, engineActivityId: undefined, engineReconciled: false },
    ]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Ok, message: 'ok' });
    await expect(confirmAndDeleteUploaded()).resolves.toBe(1);
  });

  it('parks a missing upload for manual recovery and stops confirming it', async () => {
    const retained = { ...UPLOADED };
    mockList.mockResolvedValue([retained]);
    (transitionRecording as jest.Mock).mockImplementationOnce(async (_id, transition) => {
      retained.uploadStatus = 'failed';
      delete retained.intervalsActivityId;
      retained.engineReconciled = false;
      retained.lastError = transition.error;
      return { applied: true, retryCount: 0, install: 3 };
    });
    mockConfirm.mockResolvedValue({ kind: CallKind.Http, status: 404, message: 'not found' });

    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);
    expect(transitionRecording).toHaveBeenCalledWith(
      retained.id,
      expect.objectContaining({ kind: 'rejected', error: expect.stringContaining('intervals.icu') })
    );
    expect(retained.uploadStatus).toBe('failed');
    expect(retained.intervalsActivityId).toBeUndefined();
    expect(retained.fitPath).toBe(UPLOADED.fitPath);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(recordingActions(retained, null)).toMatchObject({ canUpload: true, canShare: true });
    await expect(confirmAndDeleteUploaded()).resolves.toBe(0);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

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
    mockList.mockResolvedValue([UPLOADED]);
    mockConfirm.mockResolvedValue({ kind: CallKind.Http, status: 404, message: 'not found' });
    await confirmAndDeleteUploaded();

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
