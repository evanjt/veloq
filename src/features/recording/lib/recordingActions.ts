import type { RecordingLibraryEntry } from '@/types';

// Available actions while the recording is retained until upload confirmation.
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
