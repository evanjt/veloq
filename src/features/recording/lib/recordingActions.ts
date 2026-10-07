import type { RecordingLibraryEntry } from '@/types';

// Sharing requires a retained FIT, regardless of upload status.
export interface RecordingActions {
  isUploading: boolean;
  canUpload: boolean;
  canShare: boolean;
}

export function recordingActions(
  entry: RecordingLibraryEntry,
  uploadingId: string | null,
  fitAvailable = true
): RecordingActions {
  const isUploading = uploadingId === entry.id || entry.uploadStatus === 'uploading';
  return {
    isUploading,
    canUpload: entry.uploadStatus !== 'uploaded' && !isUploading,
    canShare: entry.kind === 'fit' && Boolean(entry.fitPath) && fitAvailable,
  };
}
