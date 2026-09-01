import type { RecordingLibraryEntry } from '@/types';

/**
 * Which actions the library detail screen offers for one recording. Sharing is
 * tied to the FIT file still being there, and a successful upload discards it
 * (`discardRecordingFit`), so an uploaded recording has nothing left to share.
 * Leaving the button up would hand `Sharing.shareAsync` a path that no longer
 * resolves, and it fails without saying so.
 */
export interface RecordingActions {
  isUploading: boolean;
  canUpload: boolean;
  canShare: boolean;
}

export function recordingActions(
  entry: RecordingLibraryEntry,
  uploadingId: string | null
): RecordingActions {
  const isUploading = uploadingId === entry.id || entry.uploadStatus === 'uploading';
  return {
    isUploading,
    canUpload: entry.uploadStatus !== 'uploaded' && !isUploading,
    canShare: entry.uploadStatus !== 'uploaded',
  };
}
