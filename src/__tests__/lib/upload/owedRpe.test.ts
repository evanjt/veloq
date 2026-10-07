/**
 * Scenario: an upload landed but the effort update that follows it did not,
 * so the ride owes intervals.icu its effort.
 *
 * Expected behaviour: the sweep sends only the effort, onto the activity the
 * upload created, and only under the athlete who recorded the ride.
 */

import { updateActivityRpe } from '@/features/recording/lib/upload/intervalsUploads';
import { sendOwedRpe } from '@/features/recording/lib/upload/owedRpe';
import {
  listRecordings,
  markRecordingRpeSent,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  updateActivityRpe: jest.fn(),
}));

let mockSignedIn: string | null = null;

jest.mock('@/shared/app/AuthStore', () => ({
  getStoredCredentials: () => ({ athleteId: mockSignedIn }),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listRecordings: jest.fn(),
  markRecordingRpeSent: jest.fn().mockResolvedValue(undefined),
}));

const mockRpe = updateActivityRpe as jest.Mock;

const RATED: RecordingLibraryEntry = {
  id: 'rec-1',
  kind: 'fit',
  fitPath: 'file:///recordings/rec-1.fit',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: Date.parse('2026-03-08T06:30:00Z'),
  durationSeconds: 3600,
  distanceMeters: 28_400,
  createdAt: Date.parse('2026-03-08T07:30:00Z'),
  uploadStatus: 'uploaded',
  intervalsActivityId: 'i999',
  retryCount: 0,
  athleteId: 'i100',
  rpe: 8,
  rpeSent: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedIn = 'i100';
  mockRpe.mockResolvedValue(undefined);
});

it('sends only the owed effort, onto the activity the upload created', async () => {
  const { intervalsActivityId: _id, ...unlanded } = RATED;
  const { rpe: _rpe, ...unrated } = RATED;
  jest
    .mocked(listRecordings)
    .mockResolvedValue([
      RATED,
      { ...RATED, id: 'sent', intervalsActivityId: 'i1', rpeSent: true },
      { ...unlanded, id: 'queued', uploadStatus: 'pending' },
      { ...unrated, id: 'unrated' },
    ]);

  expect(await sendOwedRpe()).toBe(1);

  expect(mockRpe).toHaveBeenCalledTimes(1);
  expect(mockRpe).toHaveBeenCalledWith('i999', 8);
  expect(markRecordingRpeSent).toHaveBeenCalledWith('rec-1');
});

it('keeps the effort owed when the update fails again', async () => {
  jest.mocked(listRecordings).mockResolvedValue([RATED]);
  mockRpe.mockRejectedValue(new Error('HTTP 500'));

  expect(await sendOwedRpe()).toBe(0);

  expect(markRecordingRpeSent).not.toHaveBeenCalled();
});

it("does not send another athlete's effort under the athlete signed in", async () => {
  mockSignedIn = 'i100001';
  jest.mocked(listRecordings).mockResolvedValue([{ ...RATED, athleteId: 'i200' }]);

  expect(await sendOwedRpe()).toBe(0);

  expect(mockRpe).not.toHaveBeenCalled();
});

it('skips an unstamped uploaded row owing an effort', async () => {
  const { athleteId: _athleteId, ...unstamped } = RATED;
  jest.mocked(listRecordings).mockResolvedValue([unstamped]);

  expect(await sendOwedRpe()).toBe(0);

  expect(mockRpe).not.toHaveBeenCalled();
});
