export { createAutoPauseDetector, type AutoPauseConfig } from './autoPause';
export {
  GPS_WARNING_MS,
  GPS_ALERT_MS,
  BACKUP_INTERVAL_MS,
  SPLIT_BANNER_DURATION_MS,
} from './constants';
export { getSportCategory, type SportCategory } from './sportCategoryDetector';
export { calculateSplitPace } from './splitPaceCalculator';
export {
  BACKGROUND_LOCATION_TASK,
  startBackgroundLocation,
  stopBackgroundLocation,
} from './backgroundLocation';
export { generateFitFile } from './fitGenerator';
export { getRecordingMode, RECORDING_MODE_MAP, ACTIVITY_CATEGORIES } from './recordingModes';

export {
  buildRecordingBackup,
  saveRecordingBackup,
  loadRecordingBackup,
  clearRecordingBackup,
  hasRecordingBackup,
} from './storage/recordingBackup';
export {
  saveRecording,
  listRecordings,
  getRecording,
  readRecordingFit,
  readRecordingStreams,
  requeueRecording,
  deleteRecording,
  clearPermissionBlocked,
  demotePendingToLocalOnly,
  nextPendingUpload,
  getUnuploadedCount,
  getPermissionBlockedCount,
  migrateLegacyUploadQueue,
  type SaveRecordingParams,
} from './storage/recordingLibrary';

export {
  classifyUploadError,
  type UploadErrorType,
  type UploadErrorClassification,
} from './upload/classifyUploadError';
export {
  uploadRecording,
  type UploadRecordingOutcome,
  type UploadRecordingResult,
} from './upload/uploadRecording';
