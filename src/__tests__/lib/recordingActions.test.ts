/**
 * Scenario: the recording library detail screen decides which buttons to draw.
 *
 * Expected behaviour: an uploaded recording no longer offers to share its FIT.
 * The upload discards the file, so the button would hand a dead path to the
 * share sheet and fail into an empty catch.
 */

import { recordingActions } from '@/features/recording/lib/recordingActions';
import type { RecordingLibraryEntry, RecordingUploadStatus } from '@/types';

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  fitPath: 'file:///recordings/rec-1.fit',
  activityType: 'Ride',
  name: 'Morning Ride',
  startTime: 0,
  durationSeconds: 60,
  distanceMeters: 100,
  createdAt: 0,
  uploadStatus: 'pending',
  retryCount: 0,
};

// A Record over the union rather than a list, so adding a status fails to
// compile here instead of quietly going untested.
const ALL_STATUSES: Record<RecordingUploadStatus, true> = {
  localOnly: true,
  pending: true,
  uploading: true,
  uploaded: true,
  failed: true,
  permissionBlocked: true,
};

const KEEPS_ITS_FIT = (Object.keys(ALL_STATUSES) as RecordingUploadStatus[]).filter(
  (s) => s !== 'uploaded'
);

describe('recordingActions', () => {
  it('drops the share action once the recording has uploaded', () => {
    const actions = recordingActions({ ...ENTRY, uploadStatus: 'uploaded' }, null);
    expect(actions.canShare).toBe(false);
    expect(actions.canUpload).toBe(false);
  });

  it('offers the share action for every status that still has its FIT', () => {
    for (const uploadStatus of KEEPS_ITS_FIT) {
      expect(recordingActions({ ...ENTRY, uploadStatus }, null).canShare).toBe(true);
    }
  });

  it('treats an in-flight upload as uploading from either source', () => {
    expect(recordingActions(ENTRY, 'rec-1').isUploading).toBe(true);
    expect(recordingActions({ ...ENTRY, uploadStatus: 'uploading' }, null).isUploading).toBe(true);
    expect(recordingActions(ENTRY, 'rec-2').isUploading).toBe(false);
  });

  it('does not offer a second upload while one is in flight', () => {
    expect(recordingActions(ENTRY, 'rec-1').canUpload).toBe(false);
    expect(recordingActions(ENTRY, null).canUpload).toBe(true);
  });
});
