import type { RecordingLibraryEntry } from '@/types';

// Sharing requires a retained FIT, regardless of upload status. Uploading
// requires a source that can upload: one that cannot keeps every ride on the
// device, so Upload now has nowhere to send it.
export interface RecordingActions {
  isUploading: boolean;
  canUpload: boolean;
  canShare: boolean;
}

export function recordingActions(
  entry: RecordingLibraryEntry,
  uploadingId: string | null,
  fitAvailable = true,
  sourceUploads = true
): RecordingActions {
  const isUploading = uploadingId === entry.id || entry.uploadStatus === 'uploading';
  return {
    isUploading,
    canUpload: sourceUploads && entry.uploadStatus !== 'uploaded' && !isUploading,
    canShare: entry.kind === 'fit' && Boolean(entry.fitPath) && fitAvailable,
  };
}
