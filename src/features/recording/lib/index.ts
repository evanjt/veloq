export { createAutoPauseDetector, type AutoPauseConfig } from './autoPause';
export {
  BACKGROUND_LOCATION_TASK,
  startBackgroundLocation,
  stopBackgroundLocation,
} from './backgroundLocation';
export { generateFitFile } from './fitGenerator';
export { getRecordingMode, RECORDING_MODE_MAP, ACTIVITY_CATEGORIES } from './recordingModes';

export {
  saveRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
  hasRecordingBackup,
} from './storage/recordingBackup';
export {
  enqueueUpload,
  dequeueUpload,
  markUploadComplete,
  markUploadFailed,
  getQueueSize,
  markUploadPermissionBlocked,
  clearPermissionBlocked,
  getPermissionBlockedCount,
  clearUploadQueue,
} from './storage/uploadQueue';

export {
  classifyUploadError,
  type UploadErrorType,
  type UploadErrorClassification,
} from './upload/classifyUploadError';
