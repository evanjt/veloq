import { recordingActions } from '@/features/recording/lib/recordingActions';
import type { RecordingLibraryEntry, RecordingUploadStatus } from '@/types';

const ENTRY: RecordingLibraryEntry = {
  id: 'rec-1',
  kind: 'fit',
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

const KEEPS_ITS_FIT = Object.keys(ALL_STATUSES) as RecordingUploadStatus[];

describe('recordingActions', () => {
  it('shares the retained FIT while an uploaded recording awaits confirmation', () => {
    const actions = recordingActions({ ...ENTRY, uploadStatus: 'uploaded' }, null);
    expect(actions.canShare).toBe(true);
    expect(actions.canUpload).toBe(false);
  });

  it('offers the share action for every status that still has its FIT', () => {
    for (const uploadStatus of KEEPS_ITS_FIT) {
      expect(recordingActions({ ...ENTRY, uploadStatus }, null).canShare).toBe(true);
    }
  });

  it('does not share a manual recording or a FIT without a path', () => {
    expect(recordingActions({ ...ENTRY, kind: 'manual', fitPath: '' }, null).canShare).toBe(false);
    expect(recordingActions({ ...ENTRY, fitPath: '' }, null).canShare).toBe(false);
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
